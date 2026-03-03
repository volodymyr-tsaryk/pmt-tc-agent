import dotenv from "dotenv";
dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[Agent] ERROR: ANTHROPIC_API_KEY is not set.\n" +
    "Please copy .env.example to .env and add your API key."
  );
  process.exit(1);
}

import { createServer } from "./server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const app = createServer();

app.listen(PORT, () => {
  console.log(`[Agent] Server running on http://localhost:${PORT}`);
  console.log(`[Agent] Webhooks:`);
  console.log(`  POST http://localhost:${PORT}/webhook/trello`);
  console.log(`  POST http://localhost:${PORT}/webhook/asana`);
});
