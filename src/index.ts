#!/usr/bin/env node

/**
 * FormBuddy MCP Server v2
 *
 * A world-class MCP server for AI-powered form filling.
 * Uses all three MCP primitives: Tools, Resources, and Prompts.
 *
 * Modes:
 *   Full  — Firebase + Cloud Vision → all features
 *   Cloud — Firebase only → profiles, templates, storage (no OCR)
 *   Local — no cloud services → PDF manipulation only
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, describeMode } from "./config.js";
import { initFirebase } from "./services/firebase.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerProfileTools } from "./tools/profiles.js";
import { registerAutoFillTools } from "./tools/autofill.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// Load and validate configuration
const config = loadConfig();

const server = new McpServer({
  name: config.server.name,
  version: config.server.version,
  description: "AI-powered form filling — scan documents, detect fields, auto-fill from profiles, and export completed PDFs.",
});

// Initialize Firebase if configured (non-blocking)
if (config.firebase.enabled) {
  try {
    initFirebase(config);
    console.error(`[FormBuddy] Firebase initialized (project: ${config.firebase.projectId})`);
  } catch (error) {
    console.error("[FormBuddy] Firebase initialization failed:", error);
    config.firebase.enabled = false;
  }
}

// Register all MCP primitives
registerDocumentTools(server, config);
registerProfileTools(server, config);
registerAutoFillTools(server, config);
registerResources(server, config);
registerPrompts(server);

// Start
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = describeMode(config);
  console.error(`[FormBuddy] MCP server v${config.server.version} running — mode: ${mode}`);
  console.error(`[FormBuddy] Tools: 14 | Resources: ${config.firebase.enabled ? 5 : 0} | Prompts: 4`);
}

main().catch((error) => {
  console.error("[FormBuddy] Fatal:", error);
  process.exit(1);
});
