import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { ProjectManagerAdapter } from "./adapters/interface";
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

async function handleTaskEvent(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<void> {
  // The workflow is implemented as a plain object with .run(taskId)
  // (see src/mastra/workflows/review-task.ts for rationale)
  const workflow = createReviewTaskWorkflow(config, adapter);
  await workflow.run(taskId);
}

export function createServer(): express.Application {
  const app = express();
  app.use(express.json());

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
    // TODO: verify X-Hub-Signature-256
    if (!githubAdapter) {
      res.status(503).json({ error: "GitHub integration not configured (missing GITHUB_TOKEN)" });
      return;
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

        if (payload.action !== "labeled" || payload.label?.name !== githubAdapter.triggerLabel) {
          res.status(200).json({ status: "ignored" });
          return;
        }

        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        const taskId = `${owner}/${repo}#${payload.issue.number}`;

        res.status(202).json({ status: "accepted", taskId });
        const config = await githubAdapter.fetchRepoConfig(owner, repo);
        await handleTaskEvent(taskId, githubAdapter, config);

      } else if (event === "issue_comment") {
        const payload = req.body as {
          action: string;
          comment: { body: string };
          issue: { number: number };
          repository: { name: string; owner: { login: string } };
        };

        if (
          payload.action !== "created" ||
          !payload.comment.body.includes(githubAdapter.mention)
        ) {
          res.status(200).json({ status: "ignored" });
          return;
        }

        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        const taskId = `${owner}/${repo}#${payload.issue.number}`;

        res.status(202).json({ status: "accepted", taskId });
        const config = await githubAdapter.fetchRepoConfig(owner, repo);
        await handleTaskEvent(taskId, githubAdapter, config);

      } else {
        res.status(200).json({ status: "ignored" });
      }
    } catch (error) {
      console.error("[Server] Error processing GitHub webhook:", error);
    }
  });

  return app;
}
