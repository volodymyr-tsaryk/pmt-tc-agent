import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ProjectManagerAdapter } from "../../adapters/interface";

export function createTools(adapter: ProjectManagerAdapter): Record<string, ReturnType<typeof createTool>> {
  const getTaskTool = createTool({
    id: "get_task",
    description: "Retrieve a task by ID from the project management system",
    inputSchema: z.object({
      taskId: z.string().describe("The task identifier"),
    }),
    execute: async ({ context }) => {
      return adapter.getTask(context.taskId);
    },
  });

  const addCommentTool = createTool({
    id: "add_comment",
    description: "Add a comment to a task",
    inputSchema: z.object({
      taskId: z.string().describe("The task identifier"),
      comment: z.string().describe("The comment text to add"),
    }),
    execute: async ({ context }) => {
      await adapter.addComment(context.taskId, context.comment);
      return { success: true };
    },
  });

  const setStatusTool = createTool({
    id: "set_status",
    description: "Set the status of a task",
    inputSchema: z.object({
      taskId: z.string().describe("The task identifier"),
      status: z
        .enum(["needs_clarification", "ready_for_dev"])
        .describe("The new status"),
    }),
    execute: async ({ context }) => {
      await adapter.setStatus(context.taskId, context.status);
      return { success: true };
    },
  });

  return {
    get_task: getTaskTool,
    add_comment: addCommentTool,
    set_status: setStatusTool,
  };
}
