/**
 * Simulates a GitHub "issue_comment.created" webhook event with @task-ai mention.
 *
 * Usage:
 *   TEST_OWNER=my-org TEST_REPO=my-repo TEST_ISSUE=42 npx ts-node scripts/test-github-comment.ts
 *
 * Requires: server running on PORT (default 3000), GITHUB_TOKEN and GITHUB_WEBHOOK_SECRET set in .env
 */
import crypto from "crypto";
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

const body = JSON.stringify(payload);
const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

fetch(`http://localhost:${PORT}/webhook/github`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": "issue_comment",
    "X-GitHub-Delivery": crypto.randomUUID(),
    "X-Hub-Signature-256": signature,
  },
  body,
})
  .then((r) => r.json())
  .then((data) => console.log("[test:github:comment] Response:", data))
  .catch((err) => console.error("[test:github:comment] Error:", err));
