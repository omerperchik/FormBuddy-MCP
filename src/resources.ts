import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import type { Config } from "./config.js";
import {
  listProfiles,
  getProfile,
  listTemplates,
  getTemplate,
} from "./services/firebase.js";

function getVar(variables: Variables, key: string): string {
  const val = variables[key];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * MCP Resources expose FormBuddy data as browsable, addressable URIs.
 *
 * Resource URIs:
 *   formbuddy://profiles/{userId}           → list of profiles
 *   formbuddy://profiles/{userId}/{id}      → single profile with all fields
 *   formbuddy://templates                   → all templates
 *   formbuddy://templates/{category}        → templates by category
 *   formbuddy://templates/detail/{id}       → single template metadata
 */
export function registerResources(server: McpServer, config: Config): void {
  if (!config.firebase.enabled) return;

  // ── Profile list ──
  server.resource(
    "profiles-by-user",
    new ResourceTemplate("formbuddy://profiles/{userId}", { list: undefined }),
    { description: "List all profiles for a user", mimeType: "application/json" },
    async (uri: URL, variables: Variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await listProfiles(getVar(variables, "userId")), null, 2),
        },
      ],
    })
  );

  // ── Single profile ──
  server.resource(
    "profile-detail",
    new ResourceTemplate("formbuddy://profiles/{userId}/{profileId}", { list: undefined }),
    { description: "A single profile with all field data", mimeType: "application/json" },
    async (uri: URL, variables: Variables) => {
      const profile = await getProfile(getVar(variables, "userId"), getVar(variables, "profileId"));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(profile ?? { error: "Profile not found" }, null, 2),
          },
        ],
      };
    }
  );

  // ── All templates ──
  server.resource(
    "templates-all",
    "formbuddy://templates",
    { mimeType: "application/json", description: "All FormBuddy form templates" },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await listTemplates(), null, 2),
        },
      ],
    })
  );

  // ── Templates by category ──
  server.resource(
    "templates-by-category",
    new ResourceTemplate("formbuddy://templates/{category}", { list: undefined }),
    { description: "Form templates filtered by category", mimeType: "application/json" },
    async (uri: URL, variables: Variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await listTemplates(getVar(variables, "category")), null, 2),
        },
      ],
    })
  );

  // ── Single template ──
  server.resource(
    "template-detail",
    new ResourceTemplate("formbuddy://templates/detail/{templateId}", { list: undefined }),
    { description: "A single form template with metadata", mimeType: "application/json" },
    async (uri: URL, variables: Variables) => {
      const template = await getTemplate(getVar(variables, "templateId"));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(template ?? { error: "Template not found" }, null, 2),
          },
        ],
      };
    }
  );
}
