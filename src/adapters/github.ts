import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";

export class GitHubAdapter implements ProjectManagerAdapter {
  source = "github" as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private octokitPromise: Promise<any>;
  readonly triggerLabel: string;
  readonly mention: string;

  constructor(token: string, triggerLabel: string, mention: string) {
    this.octokitPromise = import("@octokit/rest").then(
      ({ Octokit }) => new Octokit({ auth: token })
    );
    this.triggerLabel = triggerLabel;
    this.mention = mention;
  }

  private parseTaskId(taskId: string): { owner: string; repo: string; issueNumber: number } {
    // Format: "owner/repo#123"
    const match = taskId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      throw new Error(`[GitHubAdapter] Invalid taskId format: "${taskId}". Expected "owner/repo#123"`);
    }
    return { owner: match[1], repo: match[2], issueNumber: parseInt(match[3], 10) };
  }

  async getTask(_taskId: string): Promise<Task> {
    throw new Error("Not implemented");
  }

  async addComment(_taskId: string, _comment: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async setStatus(_taskId: string, _status: TaskStatus): Promise<void> {
    throw new Error("Not implemented");
  }
}
