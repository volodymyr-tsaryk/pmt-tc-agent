import { Mastra, type Agent } from "@mastra/core";
import { TrelloAdapter } from "../adapters/trello";
import { AsanaAdapter } from "../adapters/asana";
import { defaultProjectConfig } from "../config/project";
import { createTaskAnalyzerAgent } from "./agents/task-analyzer";
import { upsertAgentStatus } from "../store/event-store";

const trelloAdapter = new TrelloAdapter();
const asanaAdapter = new AsanaAdapter();

const trelloAgent = createTaskAnalyzerAgent(defaultProjectConfig, trelloAdapter);
const asanaAgent = createTaskAnalyzerAgent(defaultProjectConfig, asanaAdapter);

export const mastra: Mastra<Record<string, Agent<Record<string, any>>>> = new Mastra({
  agents: {
    [trelloAgent.name]: trelloAgent,
    [asanaAgent.name]: asanaAgent,
  },
});

export { trelloAdapter, asanaAdapter };

upsertAgentStatus(trelloAgent.name, {
  name: trelloAgent.name,
  adapter: "trello",
  lastStatus: "idle",
  lastRunAt: null,
  lastTaskId: null,
});

upsertAgentStatus(asanaAgent.name, {
  name: asanaAgent.name,
  adapter: "asana",
  lastStatus: "idle",
  lastRunAt: null,
  lastTaskId: null,
});
