import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { requireFirebase, requireOCR } from "../config.js";
import { mcpError, mcpSuccess } from "../errors.js";
import { performOCR, preprocessImage } from "../services/ocr.js";
import { autoFillPdf, getPdfInfo, createFormPdf } from "../services/pdf.js";
import { getProfile, uploadDocument, getDocumentBuffer } from "../services/firebase.js";

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

export function registerAutoFillTools(server: McpServer, config: Config): void {
  // ── form_auto_fill ──
  server.tool(
    "form_auto_fill",
    `Automatically fill a form by intelligently matching its fields to a user profile.

This is the primary high-level tool — it combines scanning, matching, and filling in one call:
1. Detects form fields (via AcroForm inspection or OCR)
2. Matches each field to the best profile data using fuzzy matching (Levenshtein distance + alias resolution)
3. Fills the form and returns the result

Each match includes a confidence score (0-1) and the matching method used.
Unmatched fields are reported so you can fill them manually with form_fill.

Supports: interactive PDFs (AcroForm) and scanned images (via OCR).`,
    {
      user_id: z.string().describe("User ID"),
      profile_id: z.string().describe("Profile ID to use for auto-filling (from profile_list)"),
      content_base64: z.string().optional().describe("Base64-encoded PDF or image"),
      storage_path: z.string().optional().describe("Firebase Storage path to the document"),
      upload: z.boolean().optional().describe("Upload result to Firebase Storage and return signed URL"),
      min_confidence: z.number().min(0).max(1).optional().describe("Minimum match confidence threshold (0-1, default 0.6). Lower = more aggressive matching."),
    },
    async ({ user_id, profile_id, content_base64, storage_path, upload, min_confidence }) => {
      // Validate Firebase for profile access
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const profile = await getProfile(user_id, profile_id);
      if (!profile) return mcpError("NOT_FOUND", `Profile '${profile_id}' not found or access denied.`);

      // Get document
      let buffer: Buffer;
      if (content_base64) {
        buffer = Buffer.from(content_base64, "base64");
      } else if (storage_path) {
        buffer = await getDocumentBuffer(storage_path);
      } else {
        return mcpError("INVALID_INPUT", "Provide either content_base64 or storage_path.");
      }

      const minScore = min_confidence ?? 0.6;

      if (isPdf(buffer)) {
        const pdfInfo = await getPdfInfo(new Uint8Array(buffer));

        if (pdfInfo.hasForm) {
          // Convert AcroForm field names into DetectedField format
          const detectedFields = pdfInfo.formFields.map((f) => ({
            label: f.name,
            type: "text" as const,
            value: "",
            confidence: 1.0,
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          }));

          const result = await autoFillPdf(new Uint8Array(buffer), detectedFields, profile.fields, { minScore });

          const response: Record<string, unknown> = {
            documentType: "pdf_interactive",
            matches: result.matches.map((m) => ({
              formField: m.detectedLabel,
              profileField: m.profileKey,
              confidence: Math.round(m.score * 100) / 100,
              method: m.method,
            })),
            filledFields: result.filledFields,
            unmatchedFields: result.unmatchedFields,
            filledCount: result.filledFields.length,
            unmatchedCount: result.unmatchedFields.length,
            totalFormFields: pdfInfo.formFields.length,
          };

          if (upload) {
            const { url } = await uploadDocument(user_id, "auto-filled-form.pdf", Buffer.from(result.pdfBytes), "application/pdf");
            response.downloadUrl = url;
          } else {
            response.pdf_base64 = Buffer.from(result.pdfBytes).toString("base64");
          }

          return mcpSuccess(response);
        }

        return mcpError("UNSUPPORTED",
          "This PDF has no interactive form fields. Convert pages to images and retry with the image, or use form_fill for text overlay.",
          { pageCount: pdfInfo.pageCount }
        );
      }

      // Image — OCR → auto-fill
      const ocrErr = requireOCR(config);
      if (ocrErr) return mcpError("MISSING_CONFIG", ocrErr);

      const processed = await preprocessImage(buffer);
      const ocrResult = await performOCR(processed, config.ocr.apiKey);

      if (ocrResult.fields.length === 0) {
        return mcpError("OCR_FAILED",
          "No form fields detected in the image. The image may not contain a form, or OCR quality is too low.",
          { fullText: ocrResult.fullText.slice(0, 500) }
        );
      }

      // Create a form PDF from detected fields and auto-fill it
      const formPdfBytes = await createFormPdf(ocrResult.fields.map((f) => ({ label: f.label, type: f.type })));
      const result = await autoFillPdf(formPdfBytes, ocrResult.fields, profile.fields, { minScore });

      const response: Record<string, unknown> = {
        documentType: "image_ocr",
        ocrProvider: ocrResult.provider,
        detectedFields: ocrResult.fields.map((f) => ({
          label: f.label,
          type: f.type,
          ocrConfidence: f.confidence,
        })),
        matches: result.matches.map((m) => ({
          formField: m.detectedLabel,
          profileField: m.profileKey,
          confidence: Math.round(m.score * 100) / 100,
          method: m.method,
        })),
        filledCount: result.filledFields.length,
        unmatchedFields: result.unmatchedFields,
        unmatchedCount: result.unmatchedFields.length,
      };

      if (upload) {
        const { url } = await uploadDocument(user_id, "auto-filled-form.pdf", Buffer.from(result.pdfBytes), "application/pdf");
        response.downloadUrl = url;
      } else {
        response.pdf_base64 = Buffer.from(result.pdfBytes).toString("base64");
      }

      return mcpSuccess(response);
    }
  );
}
