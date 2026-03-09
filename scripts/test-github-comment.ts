/**
 * Simulates a GitHub "issue_comment.created" webhook event with @task-ai mention.
 *
 * Usage:
 *   TEST_OWNER=my-org TEST_REPO=my-repo TEST_ISSUE=42 npx ts-node scripts/test-github-comment.ts
 *
 * Requires: server running on PORT (default 3000), GITHUB_TOKEN set in .env
 */
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT ?? "3000";
const OWNER = process.env.TEST_OWNER ?? "octocat";
const REPO = process.env.TEST_REPO ?? "Hello-World";
const ISSUE = parseInt(process.env.TEST_ISSUE ?? "1", 10);
const MENTION = process.env.GITHUB_MENTION ?? "@task-ai";

const payload = {
  action: "created",
  comment: {
    body: `${MENTION} please analyze this issue and create a development plan.`,
    html_url: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}#issuecomment-test`,
  },
  issue: {
    number: ISSUE,
    title: "Test issue title",
    html_url: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}`,
  },
  repository: {
    name: REPO,
    owner: { login: OWNER },
  },
  sender: { login: "test-user" },
};

fetch(`http://localhost:${PORT}/webhook/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "issue_comment",
  },
  body: JSON.stringify(payload),
})
  .then((r) => r.json())
  .then((data) => console.log("[test:github:comment] Response:", data))
  .catch((err) => console.error("[test:github:comment] Error:", err));
