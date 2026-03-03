import express, { Request, Response, NextFunction } from "express";
import { ProjectManagerAdapter } from "./adapters/interface";
import { ProjectConfig, defaultProjectConfig } from "./config/project";
import { TrelloAdapter } from "./adapters/trello";
import { AsanaAdapter } from "./adapters/asana";
import { createReviewTaskWorkflow } from "./mastra/workflows/review-task";

const trelloAdapter = new TrelloAdapter();
const asanaAdapter = new AsanaAdapter();

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

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", adapters: ["trello", "asana"] });
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

  return app;
}
