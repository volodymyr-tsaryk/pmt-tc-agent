// TODO: add a delay before checkDescription to give the author time to write a description
// In production: use Mastra's built-in step delays or an external queue (e.g. BullMQ)

import { ProjectManagerAdapter, Task } from "../../adapters/interface";
import { ProjectConfig } from "../../config/project";
import { createTaskAnalyzerAgent } from "../agents/task-analyzer";

interface CheckDescriptionResult {
  taskId: string;
  task: Task;
  passed: boolean;
  reason: string;
}

/**
 * Step 1: checkDescription
 * Fetches the task and checks it against config.reviewCriteria.
 */
async function checkDescription(
  taskId: string,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<CheckDescriptionResult> {
  console.log(`[Workflow] checkDescription: fetching task ${taskId}`);
  const task = await adapter.getTask(taskId);

  const { minDescriptionLength, requiredFields } = config.reviewCriteria;

  // Check minimum description length
  if (task.description.length < minDescriptionLength) {
    return {
      taskId,
      task,
      passed: false,
      reason: `Description is too short (${task.description.length} chars, minimum is ${minDescriptionLength}).`,
    };
  }

  // Check required fields are present and non-empty
  for (const field of requiredFields) {
    const value = (task as unknown as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === "") {
      return {
        taskId,
        task,
        passed: false,
        reason: `Required field "${field}" is missing or empty.`,
      };
    }
  }

  return {
    taskId,
    task,
    passed: true,
    reason: "Task description meets all review criteria.",
  };
}

/**
 * Step 2: analyzeOrRemind
 * If the task passed the check → runs the agent to analyze.
 * If not → posts a reminder comment and sets status to needs_clarification.
 */
async function analyzeOrRemind(
  result: CheckDescriptionResult,
  adapter: ProjectManagerAdapter,
  config: ProjectConfig
): Promise<void> {
  const { taskId, task, passed, reason } = result;

  if (passed) {
    console.log(`[Workflow] analyzeOrRemind: task ${taskId} passed — running agent`);
    const agent = createTaskAnalyzerAgent(config, adapter);
    await agent.generate(
      `Please analyze this task and produce either a Development Plan or Clarifying Questions.\n\nTask ID: ${taskId}\nTitle: ${task.title}\nDescription: ${task.description}`
    );
  } else {
    console.log(`[Workflow] analyzeOrRemind: task ${taskId} did not pass — posting reminder`);
    const reminder =
      `[TaskAnalyzer] This task needs more detail before it can be developed.\n\n` +
      `Reason: ${reason}\n\n` +
      `Please update the task description (minimum ${config.reviewCriteria.minDescriptionLength} characters) ` +
      `and ensure the following fields are filled in: ${config.reviewCriteria.requiredFields.join(", ")}.`;

    await adapter.addComment(taskId, reminder);
    await adapter.setStatus(taskId, "needs_clarification");
  }
}

/**
 * Factory that creates a review-task workflow object.
 *
 * Note: Implemented as a plain object with a `.run()` method instead of
 * the Mastra `Workflow` class because the two-step logic requires passing
 * closure state (adapter, config) between steps, which is simpler to express
 * without the typed Mastra builder API.
 *
 * TODO: migrate to Mastra `Workflow` + `createStep` builder pattern when
 *       Mastra supports context-passing between steps without generics overhead.
 */
export function createReviewTaskWorkflow(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
) {
  return {
    async run(taskId: string): Promise<void> {
      // Step 1: checkDescription
      const checkResult = await checkDescription(taskId, adapter, config);
      console.log(
        `[Workflow] checkDescription result: passed=${checkResult.passed}, reason="${checkResult.reason}"`
      );

      // Step 2: analyzeOrRemind
      await analyzeOrRemind(checkResult, adapter, config);

      console.log(`[Workflow] review-task workflow completed for task ${taskId}`);
    },
  };
}
