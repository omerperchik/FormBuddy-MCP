import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { requireFirebase, requireOCR } from "../config.js";
import { mcpError, mcpSuccess } from "../errors.js";
import { performOCR, preprocessImage } from "../services/ocr.js";
import { fillPdfForm, getPdfInfo, createFormPdf, mergePdfs, extractPages } from "../services/pdf.js";
import { uploadDocument, listTemplates, getTemplate, getDocumentBuffer } from "../services/firebase.js";

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

export function registerDocumentTools(server: McpServer, config: Config): void {
  // ── form_scan ──
  server.tool(
    "form_scan",
    `Scan a document (image or PDF) to detect form fields.

For images: runs OCR to extract text, then detects fields (names, dates, SSNs, emails, etc.) with confidence scores.
For PDFs with interactive forms: returns the AcroForm field names and types directly (no OCR needed).
For flat PDFs: reports that OCR on rendered pages is needed.

Returns: detected fields with labels, types, values, and confidence scores.
Use this before form_fill or form_auto_fill to understand what fields a document has.`,
    {
      content_base64: z.string().optional().describe("Base64-encoded image (PNG/JPG/TIFF) or PDF"),
      storage_path: z.string().optional().describe("Firebase Storage path to the document"),
      user_id: z.string().describe("User ID for access control and storage"),
    },
    async ({ content_base64, storage_path, user_id }) => {
      let buffer: Buffer;

      if (content_base64) {
        buffer = Buffer.from(content_base64, "base64");
      } else if (storage_path) {
        const fbErr = requireFirebase(config);
        if (fbErr) return mcpError("MISSING_CONFIG", fbErr);
        buffer = await getDocumentBuffer(storage_path);
      } else {
        return mcpError("INVALID_INPUT", "Provide either content_base64 or storage_path.");
      }

      if (isPdf(buffer)) {
        const pdfInfo = await getPdfInfo(new Uint8Array(buffer));

        if (pdfInfo.hasForm) {
          return mcpSuccess({
            documentType: "pdf_interactive",
            pageCount: pdfInfo.pageCount,
            title: pdfInfo.title,
            author: pdfInfo.author,
            formFields: pdfInfo.formFields,
            fieldCount: pdfInfo.formFields.length,
            hint: "This PDF has interactive form fields. Use form_fill with these field names, or form_auto_fill to match them to a profile.",
          });
        }

        return mcpSuccess({
          documentType: "pdf_flat",
          pageCount: pdfInfo.pageCount,
          title: pdfInfo.title,
          hint: "This PDF has no interactive fields. Render pages as images and re-scan for OCR, or use form_fill with text overlay mode.",
        });
      }

      // Image — run OCR
      const ocrErr = requireOCR(config);
      if (ocrErr) return mcpError("MISSING_CONFIG", ocrErr);

      const processed = await preprocessImage(buffer);
      const ocrResult = await performOCR(processed, config.ocr.apiKey);

      return mcpSuccess({
        documentType: "image",
        provider: ocrResult.provider,
        fullText: ocrResult.fullText,
        detectedFields: ocrResult.fields,
        fieldCount: ocrResult.fields.length,
        pageCount: ocrResult.pageCount,
      });
    }
  );

  // ── form_fill ──
  server.tool(
    "form_fill",
    `Fill a PDF form with specific field values.

Supports:
- Interactive PDFs (AcroForm): fills text fields, checkboxes, dropdowns, and radio buttons by field name.
- Flat PDFs: overlays text at calculated positions as a fallback.

Provide field_values as a map of field names to values. Use form_scan first to discover available field names.
Returns the filled PDF as base64, or uploads to Firebase Storage if upload=true.`,
    {
      content_base64: z.string().describe("Base64-encoded PDF content"),
      field_values: z.record(z.string(), z.string()).describe("Map of field names to values. Use form_scan to discover field names."),
      user_id: z.string().describe("User ID for access control"),
      upload: z.boolean().optional().describe("If true, uploads filled PDF to Firebase Storage and returns a signed download URL instead of base64"),
      flatten: z.boolean().optional().describe("If true (default), flattens form fields so they can't be edited. Set false to keep fields editable."),
    },
    async ({ content_base64, field_values, user_id, upload, flatten }) => {
      const pdfBytes = new Uint8Array(Buffer.from(content_base64, "base64"));

      try {
        const result = await fillPdfForm(pdfBytes, field_values, { flatten: flatten ?? true });

        const response: Record<string, unknown> = {
          filledFields: result.filledFields,
          skippedFields: result.skippedFields,
          filledCount: result.filledFields.length,
          skippedCount: result.skippedFields.length,
        };

        if (upload) {
          const fbErr = requireFirebase(config);
          if (fbErr) return mcpError("MISSING_CONFIG", fbErr);
          const { url } = await uploadDocument(user_id, "filled-form.pdf", Buffer.from(result.pdfBytes), "application/pdf");
          response.downloadUrl = url;
        } else {
          response.pdf_base64 = Buffer.from(result.pdfBytes).toString("base64");
        }

        return mcpSuccess(response);
      } catch (err) {
        return mcpError("PDF_ERROR", `Failed to fill PDF: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ── form_detect_fields ──
  server.tool(
    "form_detect_fields",
    `Inspect a PDF's structure and return its form field names, types, and metadata — without filling anything.

Useful for previewing what fields are available before calling form_fill.
Returns: field names, types (text/checkbox/dropdown/radio), page count, title, author.`,
    {
      content_base64: z.string().describe("Base64-encoded PDF content"),
    },
    async ({ content_base64 }) => {
      try {
        const pdfBytes = new Uint8Array(Buffer.from(content_base64, "base64"));
        const info = await getPdfInfo(pdfBytes);

        return mcpSuccess({
          pageCount: info.pageCount,
          hasInteractiveForm: info.hasForm,
          formFields: info.formFields,
          fieldCount: info.formFields.length,
          title: info.title,
          author: info.author,
          creationDate: info.creationDate?.toISOString(),
        });
      } catch (err) {
        return mcpError("PDF_ERROR", `Failed to analyze PDF: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ── form_create ──
  server.tool(
    "form_create",
    `Create a new interactive PDF form from scratch with specified fields.

Each field gets a label and an editable text input. The PDF is properly paginated.
Returns the PDF as base64. Use form_fill to populate it afterwards.`,
    {
      fields: z.array(z.object({
        label: z.string().describe("Field label (e.g., 'Full Name', 'Date of Birth')"),
        type: z.string().optional().default("text").describe("Field type hint (text, date, email, phone, ssn, etc.)"),
      })).describe("List of form fields to create"),
      title: z.string().optional().describe("Form title displayed at the top of the first page"),
    },
    async ({ fields, title }) => {
      const pdfBytes = await createFormPdf(fields, title);
      return mcpSuccess({
        pdf_base64: Buffer.from(pdfBytes).toString("base64"),
        fieldCount: fields.length,
        title,
      });
    }
  );

  // ── pdf_merge ──
  server.tool(
    "pdf_merge",
    `Merge multiple PDFs into a single document.

Provide an array of base64-encoded PDFs. Pages are concatenated in order.
Useful for combining a filled form with supporting documents.`,
    {
      pdfs_base64: z.array(z.string()).min(2).describe("Array of base64-encoded PDFs to merge, in order"),
    },
    async ({ pdfs_base64 }) => {
      try {
        const buffers = pdfs_base64.map((b) => new Uint8Array(Buffer.from(b, "base64")));
        const merged = await mergePdfs(buffers);
        return mcpSuccess({
          pdf_base64: Buffer.from(merged).toString("base64"),
          inputCount: pdfs_base64.length,
        });
      } catch (err) {
        return mcpError("PDF_ERROR", `Failed to merge PDFs: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ── pdf_extract_pages ──
  server.tool(
    "pdf_extract_pages",
    `Extract specific pages from a PDF into a new document.

Provide 1-based page numbers. Useful for pulling out just the pages you need to fill.`,
    {
      content_base64: z.string().describe("Base64-encoded PDF content"),
      pages: z.array(z.number().int().positive()).min(1).describe("1-based page numbers to extract (e.g., [1, 3, 5])"),
    },
    async ({ content_base64, pages }) => {
      try {
        const result = await extractPages(new Uint8Array(Buffer.from(content_base64, "base64")), pages);
        return mcpSuccess({
          pdf_base64: Buffer.from(result).toString("base64"),
          extractedPages: pages,
        });
      } catch (err) {
        return mcpError("PDF_ERROR", `Failed to extract pages: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ── form_list_templates ──
  server.tool(
    "form_list_templates",
    `Browse the FormBuddy forms library.

Filter by category (tax, legal, medical, immigration, employment, finance) or search by keyword.
Returns template IDs, names, descriptions, and categories. Use form_get_template to download one.`,
    {
      category: z.string().optional().describe("Filter by category: tax, legal, medical, immigration, employment, finance, general"),
      search: z.string().optional().describe("Search templates by name, description, or tags"),
    },
    async ({ category, search }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const templates = await listTemplates(category, search);
      return mcpSuccess({
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          tags: t.tags,
          fieldCount: t.fieldCount,
        })),
        count: templates.length,
      });
    }
  );

  // ── form_get_template ──
  server.tool(
    "form_get_template",
    `Download a specific form template by ID.

Returns the template metadata and PDF content. Use form_scan on the PDF to discover its fields, then form_fill or form_auto_fill to populate it.`,
    {
      template_id: z.string().describe("Template ID from form_list_templates"),
    },
    async ({ template_id }) => {
      const fbErr = requireFirebase(config);
      if (fbErr) return mcpError("MISSING_CONFIG", fbErr);

      const template = await getTemplate(template_id);
      if (!template) return mcpError("NOT_FOUND", `Template '${template_id}' not found.`);

      let pdfBase64: string | undefined;
      try {
        const buffer = await getDocumentBuffer(template.storagePath);
        pdfBase64 = buffer.toString("base64");
      } catch {
        // Template PDF not accessible — return metadata only
      }

      return mcpSuccess({
        ...template,
        pdf_base64: pdfBase64,
        hasPdf: !!pdfBase64,
      });
    }
  );
}
