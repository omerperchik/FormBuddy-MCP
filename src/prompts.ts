import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP Prompts provide pre-built workflow templates for common form-filling tasks.
 *
 * These guide the LLM through the optimal sequence of tool calls for each scenario.
 */
export function registerPrompts(server: McpServer): void {
  // ── Fill a form from profile ──
  server.prompt(
    "fill-form",
    `Step-by-step workflow to fill a form using a stored profile. Guides through scanning, matching, filling, and reviewing.`,
    {
      user_id: z.string().describe("User ID"),
      profile_type: z.string().optional().describe("Profile type preference: personal, business, or family"),
      document_description: z.string().optional().describe("What kind of form is this? (e.g., 'W-9 tax form', 'rental application')"),
    },
    ({ user_id, profile_type, document_description }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I need to fill out a form${document_description ? ` (${document_description})` : ""}.`,
              `My user ID is: ${user_id}`,
              profile_type ? `Please use my ${profile_type} profile.` : "",
              "",
              "Please help me through these steps:",
              "1. First, list my profiles (profile_list) so I can choose which one to use",
              "2. Once I provide the document, scan it (form_scan) to detect its fields",
              "3. Auto-fill the form using my profile (form_auto_fill)",
              "4. Show me what was filled and what was missed",
              "5. Ask me for any missing field values",
              "6. Fill in any remaining fields (form_fill)",
              "7. Return the completed PDF",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    })
  );

  // ── Create a new profile ──
  server.prompt(
    "setup-profile",
    `Interactive workflow to create a new FormBuddy profile by collecting user information step by step.`,
    {
      user_id: z.string().describe("User ID"),
      profile_type: z.enum(["personal", "business", "family"]).describe("Type of profile to create"),
    },
    ({ user_id, profile_type }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to create a new ${profile_type} profile. My user ID is: ${user_id}`,
              "",
              "Please collect the following information from me interactively:",
              "",
              profile_type === "personal"
                ? [
                    "- Full legal name (first, middle, last)",
                    "- Email address",
                    "- Phone number",
                    "- Mailing address (street, city, state, zip)",
                    "- Date of birth",
                    "- Social Security Number (I'll provide this only if needed)",
                  ].join("\n")
                : profile_type === "business"
                  ? [
                      "- Business/organization name",
                      "- Contact person name and title",
                      "- Business email and phone",
                      "- Business address",
                      "- EIN/Tax ID",
                      "- Business type (LLC, Corp, Sole Prop, etc.)",
                    ].join("\n")
                  : [
                      "- Family member name",
                      "- Relationship",
                      "- Date of birth",
                      "- Contact information",
                      "- Address (if different from primary)",
                    ].join("\n"),
              "",
              "Ask me for each piece of information one at a time.",
              "When you have everything, use profile_create to save it.",
              "Confirm the saved profile back to me.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Batch fill ──
  server.prompt(
    "batch-fill",
    `Fill multiple forms at once using the same profile. Useful for onboarding paperwork, tax season, etc.`,
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID to use"),
      count: z.string().optional().describe("How many forms to fill"),
    },
    ({ user_id, profile_id, count }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I have ${count || "several"} forms to fill using profile ${profile_id}. My user ID is: ${user_id}`,
              "",
              "For each form I provide:",
              "1. Scan it with form_scan",
              "2. Auto-fill with form_auto_fill",
              "3. Report what was filled vs. what needs manual input",
              "4. Collect any missing values from me",
              "5. Complete with form_fill if needed",
              "",
              "At the end, use pdf_merge to combine all filled forms into one document if I want.",
              "",
              "I'll start providing the forms now.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Review a filled form ──
  server.prompt(
    "review-form",
    `Review a previously filled form for completeness and accuracy.`,
    {},
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "I have a filled PDF form that I'd like you to review.",
              "",
              "Please:",
              "1. Scan it with form_scan to extract all visible fields and values",
              "2. Check for any empty or suspicious fields",
              "3. Flag any fields that look incomplete or incorrectly formatted",
              "4. Summarize what the form contains",
              "",
              "I'll provide the document next.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
