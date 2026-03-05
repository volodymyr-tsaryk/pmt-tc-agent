// src/store/event-store.ts

export type LogLevel = "info" | "warn" | "error";
export type AgentLastStatus =
  | "idle"
  | "processing"
  | "plan_written"
  | "needs_clarification"
  | "error";

export interface LogEvent {
  id: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  taskId?: string;
  adapter?: string;
}

export interface AgentStatus {
  name: string;
  adapter: string;
  lastRunAt: string | null;
  lastStatus: AgentLastStatus;
  lastTaskId: string | null;
}

const MAX_EVENTS = 200;

let _nextId = 1;
const _events: LogEvent[] = [];
const _agents: Map<string, AgentStatus> = new Map();

export function logEvent(
  source: string,
  message: string,
  opts: { level?: LogLevel; taskId?: string; adapter?: string } = {}
): void {
  const event: LogEvent = {
    id: _nextId++,
    timestamp: new Date().toISOString(),
    level: opts.level ?? "info",
    source,
    message,
    taskId: opts.taskId,
    adapter: opts.adapter,
  };
  _events.push(event);
  if (_events.length > MAX_EVENTS) {
    _events.shift();
  }
}

export function getEvents(limit = 100): LogEvent[] {
  return _events.slice(-limit);
}

export function upsertAgentStatus(name: string, patch: Partial<AgentStatus>): void {
  const existing = _agents.get(name) ?? {
    name,
    adapter: "",
    lastRunAt: null,
    lastStatus: "idle" as AgentLastStatus,
    lastTaskId: null,
  };
  _agents.set(name, { ...existing, ...patch });
}

export function getAgentStatuses(): AgentStatus[] {
  return Array.from(_agents.values());
}
