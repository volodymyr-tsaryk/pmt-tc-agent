// src/store/event-store.ts
import crypto from "node:crypto";

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

export interface TraceStep {
  timestamp: string;
  assistantText: string;
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: unknown }>;
}

export interface RunTrace {
  runId: string;
  taskId: string;
  startedAt: string;
  completedAt: string | null;
  status: AgentLastStatus | null;
  userMessage: string;
  steps: TraceStep[];
}

export interface AgentStatus {
  name: string;
  adapter: string;
  lastRunAt: string | null;
  lastStatus: AgentLastStatus;
  lastTaskId: string | null;
  runs: RunTrace[];
}

const MAX_EVENTS = 200;
const MAX_RUNS_PER_AGENT = 20;

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

function makeDefaultAgent(name: string): AgentStatus {
  return {
    name,
    adapter: "",
    lastRunAt: null,
    lastStatus: "idle",
    lastTaskId: null,
    runs: [],
  };
}

export function upsertAgentStatus(name: string, patch: Partial<AgentStatus>): void {
  const existing = _agents.get(name) ?? makeDefaultAgent(name);
  _agents.set(name, { ...existing, ...patch });
}

export function getAgentStatuses(): AgentStatus[] {
  return Array.from(_agents.values());
}

export function startRun(
  agentName: string,
  taskId: string,
  userMessage: string
): string {
  const runId = crypto.randomUUID();
  const existing = _agents.get(agentName) ?? makeDefaultAgent(agentName);

  const newRun: RunTrace = {
    runId,
    taskId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: null,
    userMessage,
    steps: [],
  };

  const runs = [...existing.runs, newRun];
  if (runs.length > MAX_RUNS_PER_AGENT) {
    runs.splice(0, runs.length - MAX_RUNS_PER_AGENT);
  }

  _agents.set(agentName, { ...existing, runs });
  return runId;
}

export function addRunStep(
  agentName: string,
  runId: string,
  step: TraceStep
): void {
  const agent = _agents.get(agentName);
  if (!agent) return;

  const runs = agent.runs.map((r) =>
    r.runId === runId ? { ...r, steps: [...r.steps, step] } : r
  );
  _agents.set(agentName, { ...agent, runs });
}

export function completeRun(
  agentName: string,
  runId: string,
  status: AgentLastStatus
): void {
  const agent = _agents.get(agentName);
  if (!agent) return;

  const runs = agent.runs.map((r) =>
    r.runId === runId
      ? { ...r, completedAt: new Date().toISOString(), status }
      : r
  );
  _agents.set(agentName, { ...agent, runs });
}
