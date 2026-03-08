import dotenv from "dotenv";
dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[Agent] ERROR: ANTHROPIC_API_KEY is not set.\n" +
    "Please copy .env.example to .env and add your API key."
  );
  process.exit(1);
}

import net from "net";
import { createServer } from "./server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Active check: try connecting to localhost (resolves to ::1 on modern systems).
// This catches cases where another process owns the port on IPv6 even though
// Express could still bind on IPv4 — the two wouldn't conflict at the socket
// level, but browsers would hit the other process instead.
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "localhost" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

(async () => {
  const inUse = await isPortInUse(PORT);
  if (inUse) {
    console.error(`[Agent] ERROR: Port ${PORT} is already in use. Set a different PORT in .env`);
    process.exit(1);
  }

  const app = createServer();

  const server = app.listen(PORT, () => {
    console.log(`[Agent] Server running on http://localhost:${PORT}`);
    console.log(`[Agent] Webhooks:`);
    console.log(`  POST http://localhost:${PORT}/webhook/trello`);
    console.log(`  POST http://localhost:${PORT}/webhook/asana`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Agent] ERROR: Port ${PORT} is already in use. Set a different PORT in .env`);
    } else {
      console.error(`[Agent] ERROR: Failed to start server:`, err.message);
    }
    process.exit(1);
  });
})();
