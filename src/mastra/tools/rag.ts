import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const searchDocsTool = createTool({
  id: "search_docs",
  description: "Search project documentation for relevant context (Phase 2)",
  inputSchema: z.object({
    query: z.string().describe("Search query for documentation"),
  }),
  execute: async ({ context }) => {
    // TODO: replace with mastra.vector.query(...) against embedded docs
    console.log(`[RAG] search_docs called with: "${context.query}" (mock)`);
    return {
      results: [],
      message: "RAG not connected (Phase 2)",
    };
  },
});

export const searchCodeTool = createTool({
  id: "search_code",
  description: "Search codebase for relevant files and patterns (Phase 2)",
  inputSchema: z.object({
    query: z.string().describe("Search query for codebase"),
  }),
  execute: async ({ context }) => {
    // TODO: replace with mastra.vector.query(...) against embedded codebase
    console.log(`[RAG] search_code called with: "${context.query}" (mock)`);
    return {
      results: [],
      message: "RAG not connected (Phase 2)",
    };
  },
});
