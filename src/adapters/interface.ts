export type TaskStatus = "needs_clarification" | "ready_for_dev";
export type AdapterSource = "trello" | "asana" | "github";

export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string | null;
  labels: string[];
  url: string;
  source: AdapterSource;
  metadata: Record<string, unknown>; // service-specific raw data
}

export interface ProjectManagerAdapter {
  source: AdapterSource;
  getTask(taskId: string): Promise<Task>;
  addComment(taskId: string, comment: string): Promise<void>;
  setStatus(taskId: string, status: TaskStatus): Promise<void>;
}

export interface ThreadComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface TriggerContext {
  triggerType: "label" | "comment";
  triggerComment?: {
    body: string;
    author: string;
  };
  thread?: ThreadComment[];
}
