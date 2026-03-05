# Design: Agent Status UI

**Date:** 2026-03-05
**Status:** Approved

## Overview

Extend the existing Express server with a lightweight, no-auth status dashboard served at `GET /`. The UI shows real-time agent statuses and a live log feed, polling the server every 3 seconds. No build step, no new dependencies, no separate process.

## Architecture

```
src/
├── store/
│   └── event-store.ts        ← in-memory ring buffer (max 200 events)
├── server.ts                 ← add GET /api/status, GET /api/logs, GET /
public/
└── index.html                ← single-file dashboard (HTML + CSS + JS)
```

The `event-store` module is a shared singleton. The workflow and server write events to it. Express exposes two read endpoints. The HTML page polls every 3 seconds via `fetch()`.

## Data Models

### Log event
```ts
interface LogEvent {
  id: string;           // uuid or incrementing id
  timestamp: string;    // ISO 8601
  level: "info" | "warn" | "error";
  source: string;       // "workflow" | "agent" | "server"
  message: string;
  taskId?: string;
  adapter?: string;     // "trello" | "asana"
}
```

### Agent status
```ts
interface AgentStatus {
  name: string;
  adapter: string;
  lastRunAt: string | null;
  lastStatus: "idle" | "processing" | "plan_written" | "needs_clarification" | "error";
  lastTaskId: string | null;
}
```

## API Endpoints

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/` | serves `public/index.html` |
| `GET` | `/api/status` | `AgentStatus[]` |
| `GET` | `/api/logs` | last 100 `LogEvent[]` (newest last) |

## UI Layout

```
┌─────────────────────────────────────────┐
│  Task Analyzer Agent  ● live            │
├──────────────┬──────────────────────────┤
│ AGENTS       │ LOG FEED                 │
│              │                          │
│ ┌──────────┐ │ 14:23:01 [workflow]      │
│ │ Trello   │ │   checkDescription ok    │
│ │ ● idle   │ │ 14:23:02 [agent]         │
│ │ last: —  │ │   plan written           │
│ └──────────┘ │ 14:23:04 [workflow]      │
│ ┌──────────┐ │   completed TRELLO-001   │
│ │ Asana    │ │                          │
│ │ ● idle   │ │                  ↑ auto  │
│ │ last: —  │ │                  scroll  │
│ └──────────┘ │                          │
└──────────────┴──────────────────────────┘
```

Status dot colors:
- ⚫ grey — idle
- 🟡 yellow — processing
- 🟢 green — plan_written
- 🟠 orange — needs_clarification
- 🔴 red — error

## Implementation Notes

- `event-store.ts` exports: `logEvent(event)`, `getEvents(limit)`, `updateAgentStatus(name, patch)`, `getAgentStatuses()`
- Workflow calls `logEvent()` at each step and `updateAgentStatus()` on start/finish
- `public/index.html` is a single file with embedded CSS and JS — no build step
- `express.static('public')` serves the file; `GET /` explicitly sends `index.html`
- Polling interval: 3000ms
- Ring buffer max size: 200 events (oldest dropped when full)
- No auth, CORS not needed (same origin)
