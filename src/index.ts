#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initFirebase } from "./services/firebase.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerProfileTools } from "./tools/profiles.js";
import { registerAutoFillTools } from "./tools/autofill.js";

const server = new McpServer({
  name: "FormBuddy",
  version: "1.0.0",
  description:
    "AI-powered form filling — scan documents, detect fields, auto-fill from profiles, and export completed PDFs.",
});

// Initialize Firebase (requires FIREBASE_PROJECT_ID env var)
try {
  initFirebase();
} catch (error) {
  console.error(
    "Firebase initialization skipped — set FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS to enable cloud features.",
    error
  );
}

// Register all tools
registerDocumentTools(server);
registerProfileTools(server);
registerAutoFillTools(server);

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FormBuddy MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start FormBuddy MCP server:", error);
  process.exit(1);
});
