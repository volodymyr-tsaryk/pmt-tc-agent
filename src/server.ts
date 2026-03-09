import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import path from "path";
import { ProjectManagerAdapter, TriggerContext } from "./adapters/interface";
import { ProjectConfig, defaultProjectConfig } from "./config/project";
import { TrelloAdapter } from "./adapters/trello";
import { AsanaAdapter } from "./adapters/asana";
import { GitHubAdapter } from "./adapters/github";
import { createReviewTaskWorkflow } from "./mastra/workflows/review-task";
import { getEvents, getAgentStatuses } from "./store/event-store";

const trelloAdapter = new TrelloAdapter();
const asanaAdapter = new AsanaAdapter();
const githubAdapter = process.env.GITHUB_TOKEN
  ? new GitHubAdapter(
      process.env.GITHUB_TOKEN,
      process.env.GITHUB_TRIGGER_LABEL ?? "ai-review",
      process.env.GITHUB_MENTION ?? "@task-ai"
    )
  : null;

// Deduplication: track recent delivery IDs to prevent processing GitHub webhook retries
const seenDeliveries = new Map<string, number>(); // deliveryId → timestamp
const DELIVERY_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Cooldown: prevent processing the same issue too frequently
const issueCooldowns = new Map<string, number>(); // taskId → lastAcceptedAt
const COOLDOWN_MS = 60 * 1000; // 60 seconds

function verifyGitHubSignature(req: Request): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!signature) return false;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig,
  triggerContext?: TriggerContext
): Promise<void> {
  // The workflow is implemented as a plain object with .run(taskId)
  // (see src/mastra/workflows/review-task.ts for rationale)
  const workflow = createReviewTaskWorkflow(config, adapter);
  await workflow.run(taskId, triggerContext);
}

export function createServer(): express.Application {
  const app = express();
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", adapters: ["trello", "asana", ...(githubAdapter ? ["github"] : [])] });
  });

  app.get("/api/status", (_req: Request, res: Response) => {
    res.json(getAgentStatuses());
  });

  app.get("/api/logs", (_req: Request, res: Response) => {
    res.json(getEvents(100));
  });

  // Trello webhook
  app.post("/webhook/trello", async (req: Request, res: Response) => {
    // TODO: verify webhook signature
    try {
      const { taskId } = req.body as { taskId?: string };
      if (!taskId) {
        res.status(400).json({ error: "Missing taskId in request body" });
        return;
      }
      res.status(202).json({ status: "accepted", taskId });
      await handleTaskEvent(taskId, trelloAdapter, defaultProjectConfig);
    } catch (error) {
      console.error("[Server] Error processing Trello webhook:", error);
    }
  });

  // Asana webhook
  app.post("/webhook/asana", async (req: Request, res: Response) => {
    // TODO: verify webhook signature
    try {
      const { taskId } = req.body as { taskId?: string };
      if (!taskId) {
        res.status(400).json({ error: "Missing taskId in request body" });
        return;
      }
      res.status(202).json({ status: "accepted", taskId });
      await handleTaskEvent(taskId, asanaAdapter, defaultProjectConfig);
    } catch (error) {
      console.error("[Server] Error processing Asana webhook:", error);
    }
  });

  // GitHub webhook
  app.post("/webhook/github", async (req: Request, res: Response) => {
    // 1. Adapter check
    if (!githubAdapter) {
      res.status(503).json({ error: "GitHub integration not configured (missing GITHUB_TOKEN)" });
      return;
    }

    // 2. HMAC signature verification
    if (!verifyGitHubSignature(req)) {
      res.status(401).json({ status: "unauthorized" });
      return;
    }

    // 3. Delivery deduplication
    const deliveryId = req.headers["x-github-delivery"] as string | undefined;
    if (deliveryId) {
      const now = Date.now();
      for (const [id, ts] of seenDeliveries) {
        if (now - ts > DELIVERY_TTL_MS) seenDeliveries.delete(id);
      }
      if (seenDeliveries.has(deliveryId)) {
        res.status(200).json({ status: "duplicate" });
        return;
      }
      seenDeliveries.set(deliveryId, now);
    }

    const event = req.headers["x-github-event"] as string | undefined;

    try {
      if (event === "issues") {
        const payload = req.body as {
          action: string;
          label?: { name: string };
          issue: { number: number };
          repository: { name: string; owner: { login: string } };
        };

        // 4. Event type filter
        if (payload.action !== "labeled" || payload.label?.name !== githubAdapter.triggerLabel) {
          res.status(200).json({ status: "ignored" });
          return;
        }

        // 5. Payload validation
        if (!payload?.issue?.number || !payload?.repository?.owner?.login || !payload?.repository?.name) {
          res.status(400).json({ error: "Malformed payload: missing issue or repository fields" });
          return;
        }

        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        const taskId = `${owner}/${repo}#${payload.issue.number}`;

        // 7. Per-issue cooldown
        const now = Date.now();
        const lastAccepted = issueCooldowns.get(taskId);
        if (lastAccepted !== undefined && now - lastAccepted < COOLDOWN_MS) {
          res.status(200).json({ status: "too_soon" });
          return;
        }
        issueCooldowns.set(taskId, now);

        // 8. Accept and process async
        res.status(202).json({ status: "accepted", taskId });
        try {
          const config = await githubAdapter.fetchRepoConfig(owner, repo);
          await handleTaskEvent(taskId, githubAdapter, config);
        } catch (innerError) {
          console.error(`[Server] GitHub task processing failed for ${taskId}:`, innerError);
          try {
            await githubAdapter.addComment(
              taskId,
              "⚠️ I encountered an error while processing this issue. Please re-trigger by commenting `@pmt-tc-agent`."
            );
          } catch (commentError) {
            console.error(`[Server] Failed to post error comment for ${taskId}:`, commentError);
          }
        }

      } else if (event === "issue_comment") {
        const payload = req.body as {
          action: string;
          comment: { body: string };
          issue: { number: number };
          repository: { name: string; owner: { login: string } };
          sender: { login: string };
        };

        // 4. Event type filter
        if (
          payload.action !== "created" ||
          !payload.comment.body.includes(githubAdapter.mention)
        ) {
          res.status(200).json({ status: "ignored" });
          return;
        }

        // 6. Loop prevention: ignore comments posted by the bot itself
        if (
          process.env.GITHUB_BOT_USERNAME &&
          payload.sender?.login === process.env.GITHUB_BOT_USERNAME
        ) {
          res.status(200).json({ status: "ignored" });
          return;
        }

        // 5. Payload validation
        if (!payload?.issue?.number || !payload?.repository?.owner?.login || !payload?.repository?.name) {
          res.status(400).json({ error: "Malformed payload: missing issue or repository fields" });
          return;
        }

        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        const taskId = `${owner}/${repo}#${payload.issue.number}`;

        // 7. Per-issue cooldown
        const now = Date.now();
        const lastAccepted = issueCooldowns.get(taskId);
        if (lastAccepted !== undefined && now - lastAccepted < COOLDOWN_MS) {
          res.status(200).json({ status: "too_soon" });
          return;
        }
        issueCooldowns.set(taskId, now);

        // 8. Accept and process async
        res.status(202).json({ status: "accepted", taskId });
        try {
          const config = await githubAdapter.fetchRepoConfig(owner, repo);
          const thread = await githubAdapter.getComments(taskId);
          const triggerContext: TriggerContext = {
            triggerType: "comment",
            triggerComment: {
              body: payload.comment.body,
              author: payload.sender.login,
            },
            thread,
          };
          await handleTaskEvent(taskId, githubAdapter, config, triggerContext);
        } catch (innerError) {
          console.error(`[Server] GitHub task processing failed for ${taskId}:`, innerError);
          try {
            await githubAdapter.addComment(
              taskId,
              "⚠️ I encountered an error while processing this issue. Please re-trigger by commenting `@pmt-tc-agent`."
            );
          } catch (commentError) {
            console.error(`[Server] Failed to post error comment for ${taskId}:`, commentError);
          }
        }

      } else {
        res.status(200).json({ status: "ignored" });
      }
    } catch (error) {
      console.error("[Server] Error processing GitHub webhook:", error);
    }
  });

  return app;
}
