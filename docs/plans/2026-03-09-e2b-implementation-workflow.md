# E2B Implementation Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a developer comments `/implement` on a GitHub issue that has a Development Plan, spin up a Claude Code instance in an E2B sandbox, implement the plan, and open a rich PR.

**Architecture:** New `implement-task` workflow (mirrors `review-task`) with two steps: `extractPlan` (finds the Development Plan comment in the thread) and `runAndPR` (E2B sandbox → Claude Code → git push → Octokit PR). A new `src/e2b/runner.ts` module wraps the E2B SDK. The server's `issue_comment` handler is extended to detect `/implement` and route to the new workflow.

**Tech Stack:** Node.js 20+, TypeScript, Express, `e2b` SDK, `@octokit/rest`, `vitest` (new — no test runner exists yet)

---

### Task 1: Install dependencies and set up test runner

**Files:**
- Modify: `package.json`

**Step 1: Install e2b SDK and vitest**

```bash
npm install e2b
npm install --save-dev vitest @vitest/coverage-v8
```

**Step 2: Add test scripts to package.json**

In the `"scripts"` block, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 2: Extend the adapter interface

**Files:**
- Modify: `src/adapters/interface.ts`

**Step 1: Write failing type test**

Create `src/adapters/__tests__/interface.test.ts`:
```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { ProjectManagerAdapter, TaskStatus, PullRequestParams, ThreadComment } from '../interface';

describe('interface types', () => {
  it('TaskStatus includes in_progress', () => {
    const s: TaskStatus = 'in_progress';
    expectTypeOf(s).toEqualTypeOf<TaskStatus>();
  });

  it('ProjectManagerAdapter has optional createPR', () => {
    expectTypeOf<ProjectManagerAdapter['createPR']>().toEqualTypeOf<
      ((params: PullRequestParams) => Promise<string>) | undefined
    >();
  });

  it('ProjectManagerAdapter has optional getComments', () => {
    expectTypeOf<ProjectManagerAdapter['getComments']>().toEqualTypeOf<
      ((taskId: string) => Promise<ThreadComment[]>) | undefined
    >();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/adapters/__tests__/interface.test.ts
```
Expected: FAIL — `in_progress` not assignable to `TaskStatus`, `PullRequestParams` not found, `getComments` not found.

**Step 3: Update interface.ts**

Replace `TaskStatus`:
```typescript
export type TaskStatus = "needs_clarification" | "ready_for_dev" | "in_progress";
```

Add `PullRequestParams` interface and optional `createPR` to `ProjectManagerAdapter`:
```typescript
export interface PullRequestParams {
  owner: string;
  repo: string;
  branch: string;
  title: string;
  body: string;
  issueNumber: number;
}

export interface ProjectManagerAdapter {
  source: AdapterSource;
  getTask(taskId: string): Promise<Task>;
  addComment(taskId: string, comment: string): Promise<void>;
  setStatus(taskId: string, status: TaskStatus): Promise<void>;
  getComments?(taskId: string): Promise<ThreadComment[]>; // optional — GitHub only (mock adapters omit it)
  createPR?(params: PullRequestParams): Promise<string>; // returns PR URL
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/adapters/__tests__/interface.test.ts
```
Expected: PASS.

**Step 5: Fix TypeScript errors from expanded TaskStatus**

Run `npx tsc --noEmit` — `GitHubAdapter.setStatus` will need a new branch for `"in_progress"`. Open `src/adapters/github.ts`, find `setStatus`, and add:
```typescript
const labelToAdd =
  status === "needs_clarification" ? "needs-clarification" :
  status === "in_progress"         ? "in-progress" :
                                     "ready-for-dev";
const labelToRemove =
  status === "needs_clarification" ? "ready-for-dev" :
  status === "in_progress"         ? "ready-for-dev" :
                                     "needs-clarification";
```

**Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 3: Implement GitHubAdapter.createPR

**Files:**
- Modify: `src/adapters/github.ts`
- Create: `src/adapters/__tests__/github-create-pr.test.ts`

**Step 1: Write failing test**

Create `src/adapters/__tests__/github-create-pr.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAdapter } from '../github';

// Mock @octokit/rest
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: { html_url: 'https://github.com/owner/repo/pull/42' }
        })
      }
    }
  }))
}));

describe('GitHubAdapter.createPR', () => {
  let adapter: GitHubAdapter;

  beforeEach(() => {
    adapter = new GitHubAdapter('fake-token', 'ai-review', '@task-ai');
  });

  it('returns the PR URL', async () => {
    const url = await adapter.createPR({
      owner: 'owner',
      repo: 'repo',
      branch: 'task-ai/123',
      title: 'task(#123): Add feature',
      body: 'Closes #123',
      issueNumber: 123,
    });
    expect(url).toBe('https://github.com/owner/repo/pull/42');
  });

  it('uses the correct Octokit parameters', async () => {
    const { Octokit } = await import('@octokit/rest');
    const mockCreate = (Octokit as any).mock.results[0].value.rest.pulls.create;

    await adapter.createPR({
      owner: 'owner',
      repo: 'repo',
      branch: 'task-ai/123',
      title: 'task(#123): Add feature',
      body: 'Closes #123',
      issueNumber: 123,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      head: 'task-ai/123',
      base: 'main',
      title: 'task(#123): Add feature',
      body: 'Closes #123',
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/adapters/__tests__/github-create-pr.test.ts
```
Expected: FAIL — `createPR` does not exist on `GitHubAdapter`.

**Step 3: Implement createPR in github.ts**

Add after `getComments`:
```typescript
async createPR(params: PullRequestParams): Promise<string> {
  const { owner, repo, branch, title, body } = params;
  console.log(`[GitHubAdapter] createPR: ${branch} → main in ${owner}/${repo}`);

  const { data: pr } = await this.octokit.rest.pulls.create({
    owner,
    repo,
    head: branch,
    base: 'main',
    title,
    body,
  });

  console.log(`[GitHubAdapter] PR created: ${pr.html_url}`);
  return pr.html_url;
}
```

Also add `PullRequestParams` to the import at the top of `github.ts`:
```typescript
import { ProjectManagerAdapter, Task, TaskStatus, ThreadComment, PullRequestParams } from "./interface";
```

Note: `ThreadComment` is already imported (it's used by `getComments` which is already implemented in `github.ts`).

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/adapters/__tests__/github-create-pr.test.ts
```
Expected: PASS.

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 4: Create src/e2b/runner.ts

This module wraps the E2B SDK. It creates a sandbox, clones the repo, writes CLAUDE.md, runs Claude Code headlessly, checks for a diff, pushes the branch, and returns the result.

**Files:**
- Create: `src/e2b/runner.ts`
- Create: `src/e2b/__tests__/runner.test.ts`

**Step 1: Write failing tests**

Create `src/e2b/__tests__/runner.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the e2b module before importing runner
const mockRun = vi.fn();
const mockWrite = vi.fn();
const mockKill = vi.fn();

vi.mock('e2b', () => ({
  Sandbox: {
    create: vi.fn().mockResolvedValue({
      commands: { run: mockRun },
      files: { write: mockWrite },
      kill: mockKill,
    })
  }
}));

import { runClaudeCodeInSandbox } from '../runner';

describe('runClaudeCodeInSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: clone succeeds, Claude Code runs, diff has changes
    mockRun.mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) return { stdout: 'src/foo.ts\n', stderr: '' };
      if (cmd.includes('git push')) return { stdout: '', stderr: '' };
      // Claude Code JSON output
      return {
        stdout: JSON.stringify({ result: 'Implemented the feature.', type: 'result' }),
        stderr: '',
      };
    });
    mockWrite.mockResolvedValue(undefined);
    mockKill.mockResolvedValue(undefined);
  });

  it('returns output and changedFiles on success', async () => {
    const result = await runClaudeCodeInSandbox({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 42,
      planText: '## Development Plan: Add foo',
      config: { name: 'TestProject', techStack: ['Node.js'], conventions: [] },
      anthropicApiKey: 'key',
      githubPat: 'pat',
    });

    expect(result.output).toContain('Implemented the feature.');
    expect(result.changedFiles).toEqual(['src/foo.ts']);
    expect(result.error).toBeUndefined();
  });

  it('returns error when clone fails', async () => {
    mockRun.mockRejectedValueOnce(new Error('clone failed'));

    const result = await runClaudeCodeInSandbox({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 42,
      planText: '## Development Plan: Add foo',
      config: { name: 'TestProject', techStack: ['Node.js'], conventions: [] },
      anthropicApiKey: 'key',
      githubPat: 'pat',
    });

    expect(result.error).toMatch('clone failed');
    expect(result.changedFiles).toEqual([]);
  });

  it('returns empty changedFiles when no diff', async () => {
    mockRun.mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) return { stdout: '', stderr: '' };
      return {
        stdout: JSON.stringify({ result: 'Nothing to implement.', type: 'result' }),
        stderr: '',
      };
    });

    const result = await runClaudeCodeInSandbox({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 42,
      planText: '## Development Plan: Add foo',
      config: { name: 'TestProject', techStack: ['Node.js'], conventions: [] },
      anthropicApiKey: 'key',
      githubPat: 'pat',
    });

    expect(result.changedFiles).toEqual([]);
  });

  it('always kills the sandbox even on error', async () => {
    mockRun.mockRejectedValueOnce(new Error('boom'));
    await runClaudeCodeInSandbox({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 42,
      planText: 'plan',
      config: { name: 'P', techStack: [], conventions: [] },
      anthropicApiKey: 'key',
      githubPat: 'pat',
    });
    expect(mockKill).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/e2b/__tests__/runner.test.ts
```
Expected: FAIL — module `../runner` does not exist.

**Step 3: Implement src/e2b/runner.ts**

Create `src/e2b/runner.ts`:
```typescript
import { Sandbox } from 'e2b';

export interface RunnerParams {
  owner: string;
  repo: string;
  issueNumber: number;
  planText: string;
  config: { name: string; techStack: string[]; conventions: string[] };
  anthropicApiKey: string;
  githubPat: string;
}

export interface RunnerResult {
  output: string;
  changedFiles: string[];
  error?: string;
}

function buildClaudeMd(params: RunnerParams): string {
  return [
    `# Project: ${params.config.name}`,
    '',
    '## Tech Stack',
    ...params.config.techStack.map((t) => `- ${t}`),
    '',
    '## Conventions',
    ...(params.config.conventions.length > 0
      ? params.config.conventions.map((c) => `- ${c}`)
      : ['- Follow existing code style']),
    '',
    '## Your Task',
    'Implement the Development Plan below. Commit all changes with a descriptive message.',
    `Use branch: task-ai/${params.issueNumber}`,
    'Do NOT push — the orchestrator will push after you finish.',
    '',
    params.planText,
  ].join('\n');
}

function extractOutputFromJson(raw: string): string {
  try {
    // Claude Code --output-format json may output multiple JSON lines (JSONL)
    const lines = raw.trim().split('\n').filter(Boolean);
    const results: string[] = [];
    for (const line of lines) {
      const parsed = JSON.parse(line);
      if (parsed.type === 'result' && parsed.result) {
        results.push(parsed.result);
      }
    }
    return results.join('\n') || raw;
  } catch {
    return raw;
  }
}

export async function runClaudeCodeInSandbox(params: RunnerParams): Promise<RunnerResult> {
  const branch = `task-ai/${params.issueNumber}`;
  const cloneUrl = `https://${params.githubPat}@github.com/${params.owner}/${params.repo}.git`;

  let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | null = null;

  try {
    sandbox = await Sandbox.create('claude', {
      envs: {
        ANTHROPIC_API_KEY: params.anthropicApiKey,
        GITHUB_PAT: params.githubPat,
      },
      timeoutMs: 300_000,
    });

    // Clone repo (--depth 1 = only latest commit, faster clone for implementation purposes)
    await sandbox.commands.run(`git clone --depth 1 ${cloneUrl} /repo`);

    // Configure git identity (required for commits inside sandbox)
    await sandbox.commands.run(
      `cd /repo && git config user.email "task-ai@bot" && git config user.name "TaskAI Bot"`
    );

    // Create and checkout branch
    await sandbox.commands.run(`cd /repo && git checkout -b ${branch}`);

    // Write CLAUDE.md with plan and instructions
    await sandbox.files.write('/repo/CLAUDE.md', buildClaudeMd(params));

    // Run Claude Code headlessly
    const claudePrompt =
      'Implement the Development Plan in CLAUDE.md. Follow all project conventions. ' +
      'Commit your changes. Do not push.';

    const claudeResult = await sandbox.commands.run(
      `cd /repo && claude -p "${claudePrompt}" --dangerously-skip-permissions --output-format json`,
    );

    const output = extractOutputFromJson(claudeResult.stdout);

    // Get list of changed files
    const diffResult = await sandbox.commands.run(
      `cd /repo && git diff HEAD~1 --name-only 2>/dev/null || git diff --cached --name-only`
    );
    const changedFiles = diffResult.stdout
      .trim()
      .split('\n')
      .filter(Boolean);

    // Push branch if there are changes
    if (changedFiles.length > 0) {
      await sandbox.commands.run(`cd /repo && git push origin ${branch}`);
    }

    return { output, changedFiles };
  } catch (err) {
    return {
      output: '',
      changedFiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await sandbox?.kill();
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/e2b/__tests__/runner.test.ts
```
Expected: all 4 tests PASS.

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 5: Create src/mastra/workflows/implement-task.ts

**Files:**
- Create: `src/mastra/workflows/implement-task.ts`
- Create: `src/mastra/workflows/__tests__/implement-task.test.ts`

**Step 1: Write failing tests**

Create `src/mastra/workflows/__tests__/implement-task.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectManagerAdapter, Task, ThreadComment } from '../../../adapters/interface';
import type { ProjectConfig } from '../../../config/project';

// Mock the e2b runner
vi.mock('../../../e2b/runner', () => ({
  runClaudeCodeInSandbox: vi.fn(),
}));

import { runClaudeCodeInSandbox } from '../../../e2b/runner';
import { createImplementTaskWorkflow } from '../implement-task';

const PLAN_COMMENT = `## Development Plan: Add login button

### Goal
Add a login button to the homepage.

### Definition of Done
- [ ] Button renders
- [ ] Tests pass`;

function makeAdapter(overrides: Partial<ProjectManagerAdapter> = {}): ProjectManagerAdapter & {
  createPR: ReturnType<typeof vi.fn>;
} {
  return {
    source: 'github' as const,
    getTask: vi.fn().mockResolvedValue({
      id: 'owner/repo#42',
      title: 'Add login button',
      description: 'Add a login button',
      assignee: null,
      labels: [],
      url: 'https://github.com/owner/repo/issues/42',
      source: 'github',
      metadata: { owner: 'owner', repo: 'repo', issueNumber: 42 },
    } satisfies Task),
    getComments: vi.fn().mockResolvedValue([
      { author: 'bot', body: PLAN_COMMENT, createdAt: '2026-01-01T00:00:00Z' },
    ] satisfies ThreadComment[]),
    addComment: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    createPR: vi.fn().mockResolvedValue('https://github.com/owner/repo/pull/99'),
    ...overrides,
  };
}

const config: ProjectConfig = {
  name: 'TestProject',
  techStack: ['Node.js'],
  conventions: ['use ESM'],
  reviewCriteria: { minDescriptionLength: 50, requiredFields: [] },
  knowledge: { enabled: false },
};

describe('implement-task workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GITHUB_PAT = 'test-pat';
  });

  it('runs the full happy path: extracts plan, calls E2B, creates PR, posts comment', async () => {
    (runClaudeCodeInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: 'Implemented the login button. Created LoginButton.tsx.',
      changedFiles: ['src/LoginButton.tsx', 'src/LoginButton.test.tsx'],
    });

    const adapter = makeAdapter();
    const workflow = createImplementTaskWorkflow(config, adapter);
    await workflow.run('owner/repo#42');

    // E2B was called with correct params
    expect(runClaudeCodeInSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        issueNumber: 42,
        planText: expect.stringContaining('## Development Plan'),
      })
    );

    // PR was created
    expect(adapter.createPR).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'task-ai/42',
        issueNumber: 42,
        owner: 'owner',
        repo: 'repo',
      })
    );

    // Comment was posted with PR URL
    expect(adapter.addComment).toHaveBeenCalledWith(
      'owner/repo#42',
      expect.stringContaining('https://github.com/owner/repo/pull/99')
    );

    // Status set to in_progress
    expect(adapter.setStatus).toHaveBeenCalledWith('owner/repo#42', 'in_progress');
  });

  it('aborts with comment when no Development Plan is found in thread', async () => {
    const adapter = makeAdapter({
      getComments: vi.fn().mockResolvedValue([
        { author: 'alice', body: 'Looks good!', createdAt: '2026-01-01T00:00:00Z' },
      ]),
    });

    const workflow = createImplementTaskWorkflow(config, adapter);
    await workflow.run('owner/repo#42');

    expect(runClaudeCodeInSandbox).not.toHaveBeenCalled();
    expect(adapter.addComment).toHaveBeenCalledWith(
      'owner/repo#42',
      expect.stringContaining('No Development Plan found')
    );
  });

  it('posts error comment and resets status when E2B sandbox fails', async () => {
    (runClaudeCodeInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: '',
      changedFiles: [],
      error: 'sandbox timed out',
    });

    const adapter = makeAdapter();
    const workflow = createImplementTaskWorkflow(config, adapter);
    await workflow.run('owner/repo#42');

    expect(adapter.createPR).not.toHaveBeenCalled();
    expect(adapter.setStatus).toHaveBeenCalledWith('owner/repo#42', 'ready_for_dev');
    expect(adapter.addComment).toHaveBeenCalledWith(
      'owner/repo#42',
      expect.stringContaining('sandbox timed out')
    );
  });

  it('posts explanation comment when E2B runs but produces no diff', async () => {
    (runClaudeCodeInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: 'The feature already appears to be implemented.',
      changedFiles: [],
    });

    const adapter = makeAdapter();
    const workflow = createImplementTaskWorkflow(config, adapter);
    await workflow.run('owner/repo#42');

    expect(adapter.createPR).not.toHaveBeenCalled();
    expect(adapter.addComment).toHaveBeenCalledWith(
      'owner/repo#42',
      expect.stringContaining('already appears to be implemented')
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/mastra/workflows/__tests__/implement-task.test.ts
```
Expected: FAIL — `../implement-task` module does not exist.

**Step 3: Implement src/mastra/workflows/implement-task.ts**

Create `src/mastra/workflows/implement-task.ts`:
```typescript
import { ProjectManagerAdapter } from "../../adapters/interface";
import { ProjectConfig } from "../../config/project";
import { runClaudeCodeInSandbox } from "../../e2b/runner";
import { logEvent, startRun, addRunStep, completeRun, upsertAgentStatus } from "../../store/event-store";

const PLAN_MARKER = "## Development Plan:";

function findLatestPlan(comments: Array<{ body: string }>): string | null {
  // Scan from newest to oldest
  for (let i = comments.length - 1; i >= 0; i--) {
    if (comments[i].body.trimStart().startsWith(PLAN_MARKER)) {
      return comments[i].body;
    }
  }
  return null;
}

function parseTaskId(taskId: string): { owner: string; repo: string; issueNumber: number } {
  const match = taskId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) throw new Error(`Invalid taskId format: "${taskId}". Expected "owner/repo#123"`);
  return { owner: match[1], repo: match[2], issueNumber: parseInt(match[3], 10) };
}

function buildPRBody(params: {
  output: string;
  changedFiles: string[];
  planText: string;
  issueNumber: number;
}): string {
  const { output, changedFiles, planText, issueNumber } = params;

  // Extract Definition of Done checklist from the plan
  const dodMatch = planText.match(/### Definition of Done\n([\s\S]*?)(?:\n###|$)/);
  const dodSection = dodMatch ? dodMatch[1].trim() : "";

  const filesList = changedFiles.length > 0
    ? changedFiles.map((f) => `- \`${f}\``).join("\n")
    : "_No files changed_";

  return [
    "## Summary",
    output,
    "",
    "## What was skipped / needs review",
    "_Review the implementation for any TODOs or incomplete sections._",
    "",
    ...(dodSection ? ["## Definition of Done", dodSection, ""] : []),
    "## Files changed",
    filesList,
    "",
    `Closes #${issueNumber}`,
  ].join("\n");
}

export function createImplementTaskWorkflow(
  config: ProjectConfig,
  adapter: ProjectManagerAdapter
) {
  const agentName = `ImplementTask-${config.name}`;

  return {
    async run(taskId: string): Promise<void> {
      upsertAgentStatus(agentName, {
        adapter: adapter.source,
        lastStatus: "processing",
        lastRunAt: new Date().toISOString(),
        lastTaskId: taskId,
      });
      logEvent("workflow", `implement-task started for ${taskId}`, { taskId });

      const runId = startRun(agentName, taskId, "implement");

      try {
        // Step 1: extractPlan
        const { owner, repo, issueNumber } = parseTaskId(taskId);
        // getComments is optional on the interface (Task 2 added it) — call via optional chaining
        const comments = await adapter.getComments?.(taskId) ?? [];
        const planText = findLatestPlan(comments);

        if (!planText) {
          const msg =
            "No Development Plan found on this issue. Please trigger analysis first by adding the `ai-review` label.";
          await adapter.addComment(taskId, msg);
          completeRun(agentName, runId, "error");
          upsertAgentStatus(agentName, { lastStatus: "error" });
          logEvent("workflow", "no plan found — aborting", { taskId, level: "warn" });
          return;
        }

        addRunStep(agentName, runId, {
          timestamp: new Date().toISOString(),
          assistantText: "Plan found. Starting E2B sandbox.",
          toolCalls: [],
          toolResults: [],
        });

        // Step 2: runAndPR
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";
        const githubPat = process.env.GITHUB_PAT ?? "";

        const result = await runClaudeCodeInSandbox({
          owner,
          repo,
          issueNumber,
          planText,
          config: {
            name: config.name,
            techStack: config.techStack,
            conventions: config.conventions,
          },
          anthropicApiKey,
          githubPat,
        });

        if (result.error) {
          const msg =
            `Implementation failed: could not complete the sandbox run.\n\n` +
            `Error: \`${result.error}\`\n\n` +
            `The Development Plan is still available above. Please re-trigger with \`/implement\` or implement manually.`;
          await adapter.addComment(taskId, msg);
          await adapter.setStatus(taskId, "ready_for_dev");
          completeRun(agentName, runId, "error");
          upsertAgentStatus(agentName, { lastStatus: "error" });
          return;
        }

        if (result.changedFiles.length === 0) {
          const msg =
            `Implementation ran but no file changes were detected.\n\n` +
            `Claude Code output:\n\n${result.output}`;
          await adapter.addComment(taskId, msg);
          completeRun(agentName, runId, "plan_written");
          upsertAgentStatus(agentName, { lastStatus: "plan_written" });
          return;
        }

        // Create PR
        const branch = `task-ai/${issueNumber}`;
        const prTitle = `task(#${issueNumber}): ${(await adapter.getTask(taskId)).title}`;
        const prBody = buildPRBody({ output: result.output, changedFiles: result.changedFiles, planText, issueNumber });

        if (!adapter.createPR) {
          await adapter.addComment(
            taskId,
            `Implementation complete but PR creation is not supported for source \`${adapter.source}\`. ` +
            `Branch \`${branch}\` was pushed — please open the PR manually.`
          );
          completeRun(agentName, runId, "plan_written");
          upsertAgentStatus(agentName, { lastStatus: "plan_written" });
          return;
        }

        let prUrl: string;
        try {
          prUrl = await adapter.createPR({ owner, repo, branch, title: prTitle, body: prBody, issueNumber });
        } catch (prErr) {
          const msg =
            `Implementation complete but PR creation failed: \`${prErr instanceof Error ? prErr.message : String(prErr)}\`.\n\n` +
            `Branch \`${branch}\` was pushed — please open the PR manually.`;
          await adapter.addComment(taskId, msg);
          completeRun(agentName, runId, "error");
          upsertAgentStatus(agentName, { lastStatus: "error" });
          return;
        }

        const summary =
          `Implementation complete. PR opened: ${prUrl}\n\n` +
          `**Files changed:**\n${result.changedFiles.map((f) => `- \`${f}\``).join("\n")}\n\n` +
          `**Claude Code summary:**\n${result.output}`;
        await adapter.addComment(taskId, summary);
        await adapter.setStatus(taskId, "in_progress");

        completeRun(agentName, runId, "plan_written");
        upsertAgentStatus(agentName, { lastStatus: "in_progress" });
        logEvent("workflow", `implement-task completed — PR: ${prUrl}`, { taskId });

      } catch (err) {
        completeRun(agentName, runId, "error");
        upsertAgentStatus(agentName, { lastStatus: "error" });
        logEvent("workflow", `implement-task error: ${err instanceof Error ? err.message : String(err)}`, {
          taskId,
          level: "error",
        });
        throw err;
      }
    },
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/mastra/workflows/__tests__/implement-task.test.ts
```
Expected: all 4 tests PASS.

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 6: Update server.ts to route /implement comments

The existing `issue_comment` handler routes all mention-containing comments to `handleTaskEvent`. We need to detect `/implement` before that and route to the implement workflow instead.

**Files:**
- Modify: `src/server.ts`

**Step 1: Write failing test**

Create `src/server/__tests__/implement-routing.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock adapters and workflows before importing server
vi.mock('../../adapters/github', () => ({
  GitHubAdapter: vi.fn().mockImplementation(() => ({
    source: 'github',
    triggerLabel: 'ai-review',
    mention: '@task-ai',
    fetchRepoConfig: vi.fn().mockResolvedValue({ name: 'Test', techStack: [], conventions: [], reviewCriteria: { minDescriptionLength: 50, requiredFields: [] }, knowledge: { enabled: false } }),
    getComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    createPR: vi.fn().mockResolvedValue('https://github.com/owner/repo/pull/1'),
  }))
}));

const mockImplementRun = vi.fn().mockResolvedValue(undefined);
const mockReviewRun = vi.fn().mockResolvedValue(undefined);

vi.mock('../../mastra/workflows/implement-task', () => ({
  createImplementTaskWorkflow: vi.fn(() => ({ run: mockImplementRun }))
}));

vi.mock('../../mastra/workflows/review-task', () => ({
  createReviewTaskWorkflow: vi.fn(() => ({ run: mockReviewRun }))
}));

process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.GITHUB_PAT = 'test-pat';

import request from 'supertest'; // add supertest to devDependencies
import crypto from 'crypto';
import { createServer } from '../../server';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
}

describe('POST /webhook/github issue_comment routing', () => {
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createServer();
  });

  it('routes /implement comment to implement workflow', async () => {
    const payload = {
      action: 'created',
      comment: { body: '/implement' },
      issue: { number: 42 },
      repository: { name: 'repo', owner: { login: 'owner' } },
      sender: { login: 'alice' },
    };
    const body = JSON.stringify(payload);

    await request(app)
      .post('/webhook/github')
      .set('x-github-event', 'issue_comment')
      .set('x-hub-signature-256', sign(body))
      .set('content-type', 'application/json')
      .send(body)
      .expect(202);

    // Give async handlers time to run
    await new Promise((r) => setTimeout(r, 50));

    expect(mockImplementRun).toHaveBeenCalledWith('owner/repo#42');
    expect(mockReviewRun).not.toHaveBeenCalled();
  });

  it('routes mention comment to review workflow', async () => {
    const payload = {
      action: 'created',
      comment: { body: '@task-ai what is the plan?' },
      issue: { number: 42 },
      repository: { name: 'repo', owner: { login: 'owner' } },
      sender: { login: 'alice' },
    };
    const body = JSON.stringify(payload);

    await request(app)
      .post('/webhook/github')
      .set('x-github-event', 'issue_comment')
      .set('x-hub-signature-256', sign(body))
      .set('content-type', 'application/json')
      .send(body)
      .expect(202);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockReviewRun).toHaveBeenCalled();
    expect(mockImplementRun).not.toHaveBeenCalled();
  });
});
```

Also install `supertest`:
```bash
npm install --save-dev supertest @types/supertest
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/__tests__/implement-routing.test.ts
```
Expected: FAIL — `/implement` routes to review workflow, not implement workflow.

**Step 3: Update server.ts**

At the top, add import:
```typescript
import { createImplementTaskWorkflow } from "./mastra/workflows/implement-task";
```

In the `issue_comment` handler, before the existing mention-check filter, add a check for `/implement`. Replace the existing filter block (lines ~217-222) with:

```typescript
// Check for /implement command (takes priority over mention)
const isImplementCommand = payload.action === "created" &&
  payload.comment.body.trim() === "/implement";

const isMentionComment = payload.action === "created" &&
  payload.comment.body.includes(githubAdapter.mention);

if (!isImplementCommand && !isMentionComment) {
  res.status(200).json({ status: "ignored" });
  return;
}
```

Then in the async processing block after `res.status(202)`, replace the single `handleTaskEvent` call with a branch:

```typescript
const config = await githubAdapter.fetchRepoConfig(owner, repo);

if (isImplementCommand) {
  const workflow = createImplementTaskWorkflow(config, githubAdapter);
  await workflow.run(taskId);
} else {
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
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/__tests__/implement-routing.test.ts
```
Expected: PASS.

**Step 5: Verify full test suite**

```bash
npx vitest run
```
Expected: all tests PASS.

**Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 7: Update environment variable validation and docs

**Files:**
- Modify: `src/index.ts`
- Modify: `.env.example` (create if absent)

**Step 1: Check current env validation in src/index.ts**

Open `src/index.ts`. Find where `ANTHROPIC_API_KEY` is validated. Add validation for `GITHUB_PAT` and `E2B_API_KEY`:

```typescript
// Add alongside existing ANTHROPIC_API_KEY check:
if (!process.env.GITHUB_PAT) {
  console.warn("[Startup] GITHUB_PAT not set — /implement workflow will fail");
}
// E2B_API_KEY warning: Phase 2 (RAG) adds a consolidated warning for both Phase 2 and Phase 3.
// If Phase 2 is already implemented, skip adding a second E2B_API_KEY warning here.
// If Phase 2 is NOT implemented, add:
//   if (!process.env.E2B_API_KEY) {
//     console.warn("[Startup] E2B_API_KEY not set — /implement workflow will fail");
//   }
```

These are warnings (not fatal) because the core analysis workflow works without them.

**Step 2: Update or create .env.example**

```bash
# Required
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# GitHub integration
GITHUB_TOKEN=your_github_app_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_TRIGGER_LABEL=ai-review
GITHUB_MENTION=@task-ai
GITHUB_BOT_USERNAME=your_bot_username

# E2B sandbox features — used by Phase 2 (RAG repo ingest) and Phase 3 (/implement workflow)
# GITHUB_TOKEN above = GitHub App installation token for Octokit API calls (issues, labels, PR creation)
# GITHUB_PAT below  = Personal Access Token for git clone/push inside E2B sandboxes (separate credential)
GITHUB_PAT=your_github_personal_access_token_here
E2B_API_KEY=your_e2b_api_key_here
# Note: if Phase 2 (RAG integration) is already implemented, GITHUB_PAT and E2B_API_KEY
# may already exist in .env — just verify they are set, do not duplicate them.

# Server
PORT=3000
```

**Step 3: Pass E2B_API_KEY to the runner**

Open `src/e2b/runner.ts`. The `e2b` SDK reads `E2B_API_KEY` from the environment automatically — no explicit passing needed. Verify this is true by checking E2B SDK docs or source. If explicit passing is required, add to `Sandbox.create` options:
```typescript
apiKey: process.env.E2B_API_KEY,
```

**Step 4: Final full verification**

```bash
npx vitest run && npx tsc --noEmit
```
Expected: all tests PASS, no TypeScript errors.

---

### Task 8: Add manual test script

**Files:**
- Create: `scripts/test-github-implement.ts`
- Modify: `package.json`

**Step 1: Create test script**

Create `scripts/test-github-implement.ts`:
```typescript
import crypto from "crypto";

const owner = process.env.TEST_OWNER ?? "owner";
const repo = process.env.TEST_REPO ?? "repo";
const issue = process.env.TEST_ISSUE ?? "1";
const port = process.env.PORT ?? "3000";
const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

const payload = {
  action: "created",
  comment: { body: "/implement" },
  issue: { number: parseInt(issue) },
  repository: { name: repo, owner: { login: owner } },
  sender: { login: "test-user" },
};

const body = JSON.stringify(payload);
const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(`http://localhost:${port}/webhook/github`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-github-event": "issue_comment",
    "x-github-delivery": `test-${Date.now()}`,
    "x-hub-signature-256": sig,
  },
  body,
});

console.log(`Status: ${res.status}`);
console.log(await res.json());
```

**Step 2: Add script to package.json**

```json
"test:github:implement": "TEST_OWNER=your-org TEST_REPO=your-repo TEST_ISSUE=1 npx ts-node scripts/test-github-implement.ts"
```

**Step 3: Manual verification**

With the dev server running (`npm run dev`), run:
```bash
npm run test:github:implement
```
Expected: `{"status":"accepted","taskId":"your-org/your-repo#1"}` and logs show sandbox being created.

---

## Summary of all files

| Action | File |
|--------|------|
| Create | `src/e2b/runner.ts` |
| Create | `src/e2b/__tests__/runner.test.ts` |
| Create | `src/mastra/workflows/implement-task.ts` |
| Create | `src/mastra/workflows/__tests__/implement-task.test.ts` |
| Create | `src/adapters/__tests__/interface.test.ts` |
| Create | `src/adapters/__tests__/github-create-pr.test.ts` |
| Create | `src/server/__tests__/implement-routing.test.ts` |
| Create | `scripts/test-github-implement.ts` |
| Create | `.env.example` |
| Modify | `src/adapters/interface.ts` |
| Modify | `src/adapters/github.ts` |
| Modify | `src/server.ts` |
| Modify | `src/index.ts` |
| Modify | `package.json` |

---

## Architecture

```
GitHub webhook (comment: "/implement")
        │
        ▼
  server.ts — issue_comment handler detects "/implement"
        │
        ▼
  createImplementTaskWorkflow(config, adapter).run(taskId)
        │
        ├─ Step 1: extractPlan
        │    adapter.getTask(taskId)       → title
        │    adapter.getComments(taskId)   → full thread
        │    → scan newest→oldest for "## Development Plan:" comment
        │    → if not found: post comment, abort (no sandbox)
        │
        └─ Step 2: runAndPR
             E2B sandbox (template: "claude", timeout: 5 min)
               ├─ git clone --depth 1 (via GITHUB_PAT)
               ├─ git checkout -b task-ai/<issueNumber>
               ├─ write /repo/CLAUDE.md (plan + config context)
               └─ claude -p "..." --dangerously-skip-permissions --output-format json
             → git diff HEAD~1 --name-only → changedFiles
             → git push origin task-ai/<issueNumber>
             GitHubAdapter.createPR(branch, title, body) → PR URL
             adapter.addComment(taskId, summary + PR URL)
             adapter.setStatus(taskId, "in_progress")
```

---

## Data Flow

### Step 1: extractPlan

1. `adapter.getTask(taskId)` → title, description
2. `adapter.getComments(taskId)` → full thread
3. Scan thread newest → oldest for comment starting with `## Development Plan:`
4. If not found → post comment explaining the requirement, abort (no sandbox created)
5. Proceeds with `{ planText, owner, repo, issueNumber }`

### Step 2: runAndPR

1. Create E2B sandbox (`template: "claude"`, `timeoutMs: 300_000`)
   - env: `ANTHROPIC_API_KEY`, `GITHUB_PAT`
2. `git clone --depth 1 https://<PAT>@github.com/<owner>/<repo>.git /repo`
3. Configure git identity (`user.email`, `user.name`) for commits inside sandbox
4. `git checkout -b task-ai/<issueNumber>`
5. Write `/repo/CLAUDE.md` — project name, tech stack, conventions, full plan, instruction to commit but not push
6. Run Claude Code headlessly:
   ```
   cd /repo && claude -p "..." --dangerously-skip-permissions --output-format json
   ```
7. Parse JSONL output → extract `result` field from lines with `"type":"result"`
8. `git diff HEAD~1 --name-only` → list of changed files
9. If no diff → post Claude Code output as comment, abort (no PR, status stays `ready_for_dev`)
10. `git push origin task-ai/<issueNumber>`
11. `GitHubAdapter.createPR(...)` → PR URL
12. `adapter.addComment(taskId, summary + PR URL)`
13. `adapter.setStatus(taskId, "in_progress")`
14. `sandbox.kill()` — always, in `finally` block

---

## PR Body Format

```markdown
## Summary
<Claude Code's summary of what was implemented>

## What was skipped / needs review
_Review the implementation for any TODOs or incomplete sections._

## Definition of Done
- [ ] criterion 1 (extracted from Development Plan)
- [ ] criterion 2

## Files changed
- `path/to/file.ts`
- `path/to/other.ts`

Closes #<issueNumber>
```

**Branch naming:** `task-ai/<issueNumber>`
**PR title:** `task(#<issueNumber>): <issue title>`

---

## Error Handling

| Failure | Action |
|---------|--------|
| No Development Plan in thread | Post comment explaining requirement, abort — no sandbox created |
| Sandbox fails to start / clone fails | Post error comment, set status back to `ready_for_dev` |
| Claude Code runs but no diff | Post Claude Code output as comment, no PR, status stays `ready_for_dev` |
| PR creation fails (branch exists etc.) | Post comment with branch name for manual PR — code is not lost |
| Timeout (5 min exceeded) | Treated as sandbox failure — post error comment, reset to `ready_for_dev` |

All errors tracked in event store under `runId`.

---

## Scope Boundaries (not in this plan)

- Trello/Asana PR creation — those adapters return "not supported"
- Per-repo E2B template customization
- Retry logic for failed sandbox runs
- Cost tracking / E2B usage limits
- Webhook signature verification (existing TODO)
