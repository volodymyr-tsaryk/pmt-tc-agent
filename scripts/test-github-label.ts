/**
 * Simulates a GitHub "issues.labeled" webhook event.
 *
 * Usage:
 *   TEST_OWNER=my-org TEST_REPO=my-repo TEST_ISSUE=42 npx ts-node scripts/test-github-label.ts
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
const LABEL = process.env.GITHUB_TRIGGER_LABEL ?? "ai-review";

const payload = {
  action: "labeled",
  label: { name: LABEL },
  issue: {
    number: ISSUE,
    title: "Test issue title",
    body: "Test issue body — this is a test triggered by the test:github:label script.",
    html_url: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}`,
    assignee: null,
    labels: [{ name: LABEL }],
    state: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    "X-GitHub-Event": "issues",
    "X-GitHub-Delivery": crypto.randomUUID(),
    "X-Hub-Signature-256": signature,
  },
  body,
})
  .then((r) => r.json())
  .then((data) => console.log("[test:github:label] Response:", data))
  .catch((err) => console.error("[test:github:label] Error:", err));
