import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { performOCR, preprocessImage } from "../services/ocr.js";
import {
  fillPdfForm,
  getPdfInfo,
  createFormPdf,
  extractPdfText,
} from "../services/pdf.js";
import {
  uploadDocument,
  listTemplates,
  getTemplate,
  getDocumentBuffer,
} from "../services/firebase.js";

export function registerDocumentTools(server: McpServer): void {
  // ── form_scan ──
  server.tool(
    "form_scan",
    "Scan an image or PDF to detect form fields using OCR. Provide either base64-encoded file content or a Firebase storage path.",
    {
      content_base64: z
        .string()
        .optional()
        .describe("Base64-encoded image or PDF content"),
      storage_path: z
        .string()
        .optional()
        .describe("Firebase Storage path to the document"),
      user_id: z.string().describe("User ID for access control"),
    },
    async ({ content_base64, storage_path, user_id }) => {
      let buffer: Buffer;

      if (content_base64) {
        buffer = Buffer.from(content_base64, "base64");
      } else if (storage_path) {
        buffer = await getDocumentBuffer(storage_path);
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Provide either content_base64 or storage_path",
              }),
            },
          ],
        };
      }

      // Detect if it's a PDF (starts with %PDF)
      const isPdf =
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46;

      if (isPdf) {
        const pdfInfo = await getPdfInfo(new Uint8Array(buffer));

        if (pdfInfo.hasForm) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  type: "pdf_with_form",
                  pageCount: pdfInfo.pageCount,
                  formFields: pdfInfo.formFieldNames,
                  title: pdfInfo.title,
                  author: pdfInfo.author,
                  message:
                    "This PDF has interactive form fields. Use form_fill with these field names.",
                }),
              },
            ],
          };
        }

        // PDF without form fields — needs OCR
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                type: "pdf_no_form",
                pageCount: pdfInfo.pageCount,
                title: pdfInfo.title,
                message:
                  "This PDF has no interactive form fields. Convert pages to images and re-scan, or use form_fill with text overlay mode.",
              }),
            },
          ],
        };
      }

      // Image — run OCR
      const processed = await preprocessImage(buffer);
      const ocrResult = await performOCR(processed);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              type: "ocr_result",
              fullText: ocrResult.fullText,
              detectedFields: ocrResult.fields,
              fieldCount: ocrResult.fields.length,
              pageCount: ocrResult.pageCount,
            }),
          },
        ],
      };
    }
  );

  // ── form_fill ──
  server.tool(
    "form_fill",
    "Fill a PDF form with provided field values. Returns the filled PDF as base64.",
    {
      content_base64: z.string().describe("Base64-encoded PDF content"),
      field_values: z
        .record(z.string(), z.string())
        .describe("Map of field names to values"),
      user_id: z.string().describe("User ID for access control"),
      upload: z
        .boolean()
        .optional()
        .describe("Upload filled PDF to Firebase Storage and return URL"),
    },
    async ({ content_base64, field_values, user_id, upload }) => {
      const pdfBytes = new Uint8Array(Buffer.from(content_base64, "base64"));
      const result = await fillPdfForm(pdfBytes, field_values);

      const response: Record<string, unknown> = {
        filledFields: result.filledFields,
        skippedFields: result.skippedFields,
        filledCount: result.filledFields.length,
        skippedCount: result.skippedFields.length,
      };

      if (upload) {
        const url = await uploadDocument(
          user_id,
          "filled-form.pdf",
          Buffer.from(result.pdfBytes),
          "application/pdf"
        );
        response.downloadUrl = url;
      } else {
        response.pdf_base64 = Buffer.from(result.pdfBytes).toString("base64");
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
      };
    }
  );

  // ── form_detect_fields ──
  server.tool(
    "form_detect_fields",
    "Analyze a PDF and return its form field names and types without filling them.",
    {
      content_base64: z.string().describe("Base64-encoded PDF content"),
    },
    async ({ content_base64 }) => {
      const pdfBytes = new Uint8Array(Buffer.from(content_base64, "base64"));
      const info = await getPdfInfo(pdfBytes);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              pageCount: info.pageCount,
              hasInteractiveForm: info.hasForm,
              formFieldNames: info.formFieldNames,
              title: info.title,
              author: info.author,
            }),
          },
        ],
      };
    }
  );

  // ── form_create ──
  server.tool(
    "form_create",
    "Create a new PDF form with specified fields. Returns the PDF as base64.",
    {
      fields: z
        .array(
          z.object({
            label: z.string(),
            type: z.string().optional().default("text"),
          })
        )
        .describe("List of form fields to create"),
      title: z.string().optional().describe("Form title"),
    },
    async ({ fields }) => {
      const pdfBytes = await createFormPdf(fields);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              pdf_base64: Buffer.from(pdfBytes).toString("base64"),
              fieldCount: fields.length,
            }),
          },
        ],
      };
    }
  );

  // ── form_list_templates ──
  server.tool(
    "form_list_templates",
    "Browse the FormBuddy forms library. Optionally filter by category.",
    {
      category: z
        .string()
        .optional()
        .describe("Filter templates by category (e.g., 'tax', 'legal', 'medical')"),
    },
    async ({ category }) => {
      const templates = await listTemplates(category);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              templates: templates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                category: t.category,
              })),
              count: templates.length,
            }),
          },
        ],
      };
    }
  );

  // ── form_get_template ──
  server.tool(
    "form_get_template",
    "Get a specific form template by ID. Returns template metadata and PDF.",
    {
      template_id: z.string().describe("Template ID"),
    },
    async ({ template_id }) => {
      const template = await getTemplate(template_id);

      if (!template) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Template not found" }),
            },
          ],
        };
      }

      let pdfBase64: string | undefined;
      try {
        const buffer = await getDocumentBuffer(template.storagePath);
        pdfBase64 = buffer.toString("base64");
      } catch {
        // Template PDF not accessible
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...template,
              pdf_base64: pdfBase64,
            }),
          },
        ],
      };
    }
  );
}
