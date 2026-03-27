import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { requireFirebase } from "../config.js";
import { mcpError, mcpSuccess } from "../errors.js";
import { listProfiles, getProfile, createProfile, updateProfile, deleteProfile } from "../services/firebase.js";

export function registerProfileTools(server: McpServer, config: Config): void {
  // ── profile_list ──
  server.tool(
    "profile_list",
    `List all profiles for a user.

Profiles store personal data (name, address, SSN, etc.) used to auto-fill forms.
Each user can have multiple profiles: personal, business, and family.
Returns profile IDs, names, types, and field counts. Use profile_get to see full field data.`,
    {
      user_id: z.string().describe("User ID"),
    },
    async ({ user_id }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const profiles = await listProfiles(user_id);
      return mcpSuccess({
        profiles: profiles.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          fieldCount: Object.keys(p.fields).length,
          fieldNames: Object.keys(p.fields),
          updatedAt: p.updatedAt,
        })),
        count: profiles.length,
      });
    }
  );

  // ── profile_get ──
  server.tool(
    "profile_get",
    `Get a specific profile with all its field data.

Returns the full profile including all stored fields (name, address, SSN, etc.).
This data is what form_auto_fill uses to populate forms.`,
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID from profile_list"),
    },
    async ({ user_id, profile_id }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const profile = await getProfile(user_id, profile_id);
      if (!profile) return mcpError("NOT_FOUND", `Profile '${profile_id}' not found or access denied.`);

      return mcpSuccess(profile);
    }
  );

  // ── profile_create ──
  server.tool(
    "profile_create",
    `Create a new profile for form auto-filling.

Common field names: firstName, lastName, email, phone, address, city, state, zip,
ssn, dob, company, title, signature. Use consistent naming for best auto-fill matching.`,
    {
      user_id: z.string().describe("User ID"),
      name: z.string().describe("Profile display name (e.g., 'Personal', 'Acme Corp')"),
      type: z.enum(["personal", "business", "family"]).describe("Profile category"),
      fields: z.record(z.string(), z.string()).describe(
        "Profile data fields. Keys are field names (e.g., 'firstName'), values are the data (e.g., 'John'). Use camelCase keys for best matching."
      ),
    },
    async ({ user_id, name, type, fields }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const profile = await createProfile(user_id, { name, type, fields });
      return mcpSuccess({ message: "Profile created", profile });
    }
  );

  // ── profile_update ──
  server.tool(
    "profile_update",
    `Update an existing profile. Fields are merged (not replaced) — only specify fields you want to change.

To remove a field, set its value to an empty string.`,
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID to update"),
      name: z.string().optional().describe("New display name"),
      type: z.enum(["personal", "business", "family"]).optional().describe("New profile type"),
      fields: z.record(z.string(), z.string()).optional().describe("Fields to add or update (merged with existing fields)"),
    },
    async ({ user_id, profile_id, name, type, fields }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const profile = await updateProfile(user_id, profile_id, { name, type, fields });
      if (!profile) return mcpError("NOT_FOUND", `Profile '${profile_id}' not found or access denied.`);

      return mcpSuccess({ message: "Profile updated", profile });
    }
  );

  // ── profile_delete ──
  server.tool(
    "profile_delete",
    `Permanently delete a profile and all its stored field data. This cannot be undone.`,
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID to delete"),
    },
    async ({ user_id, profile_id }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const deleted = await deleteProfile(user_id, profile_id);
      if (!deleted) return mcpError("NOT_FOUND", `Profile '${profile_id}' not found or access denied.`);

      return mcpSuccess({ message: "Profile deleted", profileId: profile_id });
    }
  );
}
