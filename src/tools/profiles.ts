import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
} from "../services/firebase.js";

export function registerProfileTools(server: McpServer): void {
  // ── profile_list ──
  server.tool(
    "profile_list",
    "List all profiles for a user (personal, business, family).",
    {
      user_id: z.string().describe("User ID"),
    },
    async ({ user_id }) => {
      const profiles = await listProfiles(user_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              profiles: profiles.map((p) => ({
                id: p.id,
                name: p.name,
                type: p.type,
                fieldCount: Object.keys(p.fields).length,
                updatedAt: p.updatedAt,
              })),
              count: profiles.length,
            }),
          },
        ],
      };
    }
  );

  // ── profile_get ──
  server.tool(
    "profile_get",
    "Get a specific profile with all its field data.",
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID"),
    },
    async ({ user_id, profile_id }) => {
      const profile = await getProfile(user_id, profile_id);

      if (!profile) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Profile not found" }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(profile),
          },
        ],
      };
    }
  );

  // ── profile_create ──
  server.tool(
    "profile_create",
    "Create a new profile for form auto-filling.",
    {
      user_id: z.string().describe("User ID"),
      name: z.string().describe("Profile name (e.g., 'Personal', 'My Business')"),
      type: z
        .enum(["personal", "business", "family"])
        .describe("Profile type"),
      fields: z
        .record(z.string(), z.string())
        .describe(
          "Profile fields (e.g., { firstName: 'John', lastName: 'Doe', email: 'john@example.com' })"
        ),
    },
    async ({ user_id, name, type, fields }) => {
      const profile = await createProfile(user_id, { name, type, fields });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message: "Profile created successfully",
              profile,
            }),
          },
        ],
      };
    }
  );

  // ── profile_update ──
  server.tool(
    "profile_update",
    "Update an existing profile's name, type, or fields.",
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID to update"),
      name: z.string().optional().describe("New profile name"),
      type: z
        .enum(["personal", "business", "family"])
        .optional()
        .describe("New profile type"),
      fields: z
        .record(z.string(), z.string())
        .optional()
        .describe("Updated profile fields (merges with existing)"),
    },
    async ({ user_id, profile_id, name, type, fields }) => {
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (type !== undefined) updates.type = type;
      if (fields !== undefined) updates.fields = fields;

      const profile = await updateProfile(user_id, profile_id, updates as {
        name?: string;
        type?: "personal" | "business" | "family";
        fields?: Record<string, string>;
      });

      if (!profile) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Profile not found or access denied" }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message: "Profile updated successfully",
              profile,
            }),
          },
        ],
      };
    }
  );
}
