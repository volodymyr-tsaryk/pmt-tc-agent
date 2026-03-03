import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";

const mockTasks: Record<string, Task> = {
  "TRELLO-001": {
    id: "TRELLO-001",
    title: "Implement user authentication with OAuth2",
    description:
      "Add OAuth2 authentication to the application. Users should be able to sign in with Google and GitHub. " +
      "Implement the following: (1) Install next-auth v5 and configure OAuth providers. " +
      "(2) Create /api/auth/[...nextauth]/route.ts handler. " +
      "(3) Add sign-in/sign-out buttons to the header. " +
      "(4) Protect dashboard routes with middleware. " +
      "(5) Store user sessions in PostgreSQL via Prisma adapter. " +
      "Acceptance criteria: unauthenticated users redirected to /login, " +
      "authenticated users see their avatar in the header.",
    assignee: "alice@example.com",
    labels: ["feature", "auth", "backend"],
    url: "https://trello.com/c/TRELLO-001",
    source: "trello",
    metadata: {
      boardId: "board-123",
      listName: "In Progress",
      dueDate: "2026-03-15",
    },
  },
  "TRELLO-002": {
    id: "TRELLO-002",
    title: "Fix the dashboard",
    description: "Something is broken on the dashboard page. Please fix it.",
    assignee: null,
    labels: ["bug"],
    url: "https://trello.com/c/TRELLO-002",
    source: "trello",
    metadata: {
      boardId: "board-123",
      listName: "Backlog",
    },
  },
  "TRELLO-003": {
    id: "TRELLO-003",
    title: "Add CSV export to reports",
    description:
      "Users need to export their monthly reports as CSV files. " +
      "Add an 'Export CSV' button to the /reports page. " +
      "On click, generate a CSV with columns: Date, Category, Amount, Description. " +
      "Use the papaparse library for CSV generation. " +
      "The file should be named 'report-YYYY-MM.csv'. " +
      "Acceptance criteria: CSV downloads correctly in Chrome and Firefox, " +
      "all report rows are included, no empty rows.",
    assignee: "bob@example.com",
    labels: ["feature", "reports"],
    url: "https://trello.com/c/TRELLO-003",
    source: "trello",
    metadata: {
      boardId: "board-456",
      listName: "To Do",
    },
  },
};

export class TrelloAdapter implements ProjectManagerAdapter {
  source = "trello" as const;

  async getTask(taskId: string): Promise<Task> {
    // TODO: replace with real API call
    console.log(`[TrelloAdapter] getTask("${taskId}")`);
    const task = mockTasks[taskId];
    if (!task) {
      throw new Error(`[TrelloAdapter] Task not found: ${taskId}`);
    }
    return task;
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    // TODO: replace with real API call
    console.log(`[TrelloAdapter] addComment("${taskId}", "${comment.substring(0, 80)}...")`);
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    // TODO: replace with real API call
    console.log(`[TrelloAdapter] setStatus("${taskId}", "${status}")`);
  }
}
