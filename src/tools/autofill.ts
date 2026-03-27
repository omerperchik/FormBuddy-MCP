import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { performOCR, preprocessImage, detectFieldsFromText } from "../services/ocr.js";
import { autoFillPdf, getPdfInfo } from "../services/pdf.js";
import {
  getProfile,
  uploadDocument,
  getDocumentBuffer,
} from "../services/firebase.js";

export function registerAutoFillTools(server: McpServer): void {
  // ── form_auto_fill ──
  server.tool(
    "form_auto_fill",
    "Automatically fill a form by matching detected fields to a user profile. Scans the document, matches fields to profile data, and returns the filled PDF.",
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID to use for auto-filling"),
      content_base64: z
        .string()
        .optional()
        .describe("Base64-encoded PDF or image content"),
      storage_path: z
        .string()
        .optional()
        .describe("Firebase Storage path to the document"),
      upload: z
        .boolean()
        .optional()
        .describe("Upload filled PDF to Firebase Storage and return URL"),
    },
    async ({ user_id, profile_id, content_base64, storage_path, upload }) => {
      // Get the profile
      const profile = await getProfile(user_id, profile_id);
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

      // Get document bytes
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

      const isPdf =
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46;

      const pdfBytes = new Uint8Array(buffer);

      if (isPdf) {
        // Check for AcroForm fields first
        const pdfInfo = await getPdfInfo(pdfBytes);

        if (pdfInfo.hasForm) {
          // Match AcroForm field names to profile fields
          const { autoFillPdf: autoFill } = await import("../services/pdf.js");
          const detectedFields = pdfInfo.formFieldNames.map((name) => ({
            label: name,
            type: "text" as const,
            value: "",
            confidence: 1.0,
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          }));

          const result = await autoFill(pdfBytes, detectedFields, profile.fields);

          const response: Record<string, unknown> = {
            matchedFields: result.matchedFields,
            filledFields: result.filledFields,
            skippedFields: result.skippedFields,
            filledCount: result.filledFields.length,
            skippedCount: result.skippedFields.length,
            totalFormFields: pdfInfo.formFieldNames.length,
          };

          if (upload) {
            const url = await uploadDocument(
              user_id,
              "auto-filled-form.pdf",
              Buffer.from(result.pdfBytes),
              "application/pdf"
            );
            response.downloadUrl = url;
          } else {
            response.pdf_base64 = Buffer.from(result.pdfBytes).toString("base64");
          }

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(response) },
            ],
          };
        }

        // PDF without form fields — try OCR
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "This PDF has no interactive form fields. Convert to image and retry, or use form_fill with manual field positions.",
                pageCount: pdfInfo.pageCount,
              }),
            },
          ],
        };
      }

      // Image — run OCR then auto-fill onto a new form PDF
      const processed = await preprocessImage(buffer);
      const ocrResult = await performOCR(processed);

      if (ocrResult.fields.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No form fields detected in the image",
                fullText: ocrResult.fullText,
              }),
            },
          ],
        };
      }

      // Create a form PDF and auto-fill it
      const { createFormPdf } = await import("../services/pdf.js");
      const formPdfBytes = await createFormPdf(
        ocrResult.fields.map((f) => ({ label: f.label, type: f.type }))
      );

      const result = await autoFillPdf(
        formPdfBytes,
        ocrResult.fields,
        profile.fields
      );

      const response: Record<string, unknown> = {
        detectedFields: ocrResult.fields.map((f) => ({
          label: f.label,
          type: f.type,
          confidence: f.confidence,
        })),
        matchedFields: result.matchedFields,
        filledFields: result.filledFields,
        skippedFields: result.skippedFields,
        filledCount: result.filledFields.length,
        unmatchedCount:
          ocrResult.fields.length - result.matchedFields.length,
      };

      if (upload) {
        const url = await uploadDocument(
          user_id,
          "auto-filled-form.pdf",
          Buffer.from(result.pdfBytes),
          "application/pdf"
        );
        response.downloadUrl = url;
      } else {
        response.pdf_base64 = Buffer.from(result.pdfBytes).toString("base64");
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(response) },
        ],
      };
    }
  );
}
