import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";

const mockTasks: Record<string, Task> = {
  "ASANA-001": {
    id: "ASANA-001",
    title: "Migrate database to PostgreSQL 16",
    description:
      "Upgrade the database from PostgreSQL 14 to PostgreSQL 16. Steps: " +
      "(1) Back up all production data. " +
      "(2) Update docker-compose.yml to use postgres:16-alpine. " +
      "(3) Run pg_upgrade or pg_dumpall + restore. " +
      "(4) Update connection string in .env.production. " +
      "(5) Run full regression test suite. " +
      "(6) Monitor for 48 hours post-migration. " +
      "Rollback plan: restore from backup if error rate > 1%. " +
      "Acceptance criteria: all tests pass on PG16, p99 query time unchanged.",
    assignee: "charlie@example.com",
    labels: ["infrastructure", "database"],
    url: "https://app.asana.com/0/1/ASANA-001",
    source: "asana",
    metadata: {
      projectId: "asana-project-789",
      sectionName: "Sprint 12",
      priority: "high",
    },
  },
  "ASANA-002": {
    id: "ASANA-002",
    title: "Improve performance",
    description: "The app feels slow. Make it faster.",
    assignee: null,
    labels: ["performance"],
    url: "https://app.asana.com/0/1/ASANA-002",
    source: "asana",
    metadata: {
      projectId: "asana-project-789",
      sectionName: "Backlog",
      priority: "medium",
    },
  },
};

export class AsanaAdapter implements ProjectManagerAdapter {
  source = "asana" as const;

  async getTask(taskId: string): Promise<Task> {
    // TODO: replace with real API call
    console.log(`[AsanaAdapter] getTask("${taskId}")`);
    const task = mockTasks[taskId];
    if (!task) {
      throw new Error(`[AsanaAdapter] Task not found: ${taskId}`);
    }
    return task;
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    // TODO: replace with real API call
    console.log(`[AsanaAdapter] addComment("${taskId}", "${comment.substring(0, 80)}...")`);
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    // TODO: replace with real API call
    console.log(`[AsanaAdapter] setStatus("${taskId}", "${status}")`);
  }
}
