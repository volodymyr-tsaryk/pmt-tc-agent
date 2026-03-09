import { Octokit } from "@octokit/rest";
import matter from "gray-matter";
import { ProjectManagerAdapter, Task, TaskStatus } from "./interface";
import { ProjectConfig, defaultProjectConfig } from "../config/project";

export class GitHubAdapter implements ProjectManagerAdapter {
  source = "github" as const;

  private octokit: Octokit;
  readonly triggerLabel: string;
  readonly mention: string;

  constructor(token: string, triggerLabel: string, mention: string) {
    this.octokit = new Octokit({ auth: token });
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

  async getTask(taskId: string): Promise<Task> {
    console.log(`[GitHubAdapter] getTask("${taskId}")`);
    const { owner, repo, issueNumber } = this.parseTaskId(taskId);

    const { data: issue } = await this.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    return {
      id: taskId,
      title: issue.title,
      description: issue.body ?? "",
      assignee: issue.assignee?.login ?? null,
      labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
      url: issue.html_url,
      source: "github",
      metadata: {
        owner,
        repo,
        issueNumber,
        state: issue.state,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
      },
    };
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    const preview = comment.length > 80 ? comment.substring(0, 80) + "..." : comment;
    console.log(`[GitHubAdapter] addComment("${taskId}", "${preview}")`);
    const { owner, repo, issueNumber } = this.parseTaskId(taskId);

    await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: comment,
    });

    console.log(`[GitHubAdapter] Comment posted to ${taskId}`);
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    console.log(`[GitHubAdapter] setStatus("${taskId}", "${status}")`);
    const { owner, repo, issueNumber } = this.parseTaskId(taskId);

    const labelToAdd = status === "needs_clarification" ? "needs-clarification" : "ready-for-dev";
    const labelToRemove = status === "needs_clarification" ? "ready-for-dev" : "needs-clarification";

    // Add the new label
    await this.octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [labelToAdd],
    });

    // Remove the conflicting label — ignore 404 (label wasn't on the issue)
    try {
      await this.octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelToRemove,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
    }

    console.log(`[GitHubAdapter] Label "${labelToAdd}" added to ${taskId}`);
  }

  async fetchRepoConfig(owner: string, repo: string): Promise<ProjectConfig> {
    try {
      const { data: fileData } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: ".github/task-ai.md",
      });

      if (Array.isArray(fileData) || fileData.type !== "file") {
        console.warn(`[GitHubAdapter] .github/task-ai.md is not a file in ${owner}/${repo}, using default config`);
        return defaultProjectConfig;
      }

      const content = Buffer.from(fileData.content, "base64").toString("utf8");
      const { data: frontmatter } = matter(content);

      return {
        name: frontmatter.name ?? `${owner}/${repo}`,
        techStack: frontmatter.techStack ?? defaultProjectConfig.techStack,
        conventions: frontmatter.conventions ?? defaultProjectConfig.conventions,
        reviewCriteria: {
          minDescriptionLength:
            frontmatter.reviewCriteria?.minDescriptionLength ??
            defaultProjectConfig.reviewCriteria.minDescriptionLength,
          requiredFields:
            frontmatter.reviewCriteria?.requiredFields ??
            defaultProjectConfig.reviewCriteria.requiredFields,
        },
        knowledge: { enabled: false }, // Phase 2: parse body for RAG
      };
    } catch (err: unknown) {
      const errStatus = (err as { status?: number }).status;
      if (errStatus === 404) {
        console.warn(`[GitHubAdapter] .github/task-ai.md not found in ${owner}/${repo}, using default config`);
      } else {
        console.error(`[GitHubAdapter] Failed to fetch repo config for ${owner}/${repo}:`, err);
      }
      return defaultProjectConfig;
    }
  }
}
