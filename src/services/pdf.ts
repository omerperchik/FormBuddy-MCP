import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import type { DetectedField } from "./ocr.js";
import { matchAllFields, type FieldMatch } from "./matching.js";

export interface FillResult {
  pdfBytes: Uint8Array;
  filledFields: string[];
  skippedFields: string[];
}

export interface AutoFillResult extends FillResult {
  matches: FieldMatch[];
  unmatchedFields: string[];
}

/**
 * Fill a PDF form's AcroForm fields with provided values.
 * Falls back to text overlay if no AcroForm fields are present.
 */
export async function fillPdfForm(
  pdfBytes: Uint8Array,
  fieldValues: Record<string, string>,
  options?: { flatten?: boolean }
): Promise<FillResult> {
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();
  const formFields = form.getFields();

  const filledFields: string[] = [];
  const skippedFields: string[] = [];
  const shouldFlatten = options?.flatten ?? true;

  if (formFields.length > 0) {
    for (const [key, value] of Object.entries(fieldValues)) {
      if (tryFillField(form, key, value)) {
        filledFields.push(key);
      } else {
        skippedFields.push(key);
      }
    }
    if (shouldFlatten) form.flatten();
  } else {
    const result = await overlayTextOnPdf(pdf, fieldValues);
    filledFields.push(...result.filled);
    skippedFields.push(...result.skipped);
  }

  const resultBytes = await pdf.save();
  return { pdfBytes: resultBytes, filledFields, skippedFields };
}

function tryFillField(form: ReturnType<PDFDocument["getForm"]>, key: string, value: string): boolean {
  // Try text field
  try {
    const field = form.getTextField(key);
    field.setText(value);
    return true;
  } catch { /* not a text field or doesn't exist */ }

  // Try checkbox
  try {
    const checkbox = form.getCheckBox(key);
    const truthy = ["true", "yes", "1", "x", "on"].includes(value.toLowerCase());
    truthy ? checkbox.check() : checkbox.uncheck();
    return true;
  } catch { /* not a checkbox */ }

  // Try dropdown
  try {
    const dropdown = form.getDropdown(key);
    dropdown.select(value);
    return true;
  } catch { /* not a dropdown */ }

  // Try radio group
  try {
    const radio = form.getRadioGroup(key);
    radio.select(value);
    return true;
  } catch { /* not a radio group */ }

  return false;
}

/**
 * Overlay text onto a PDF, paginating as needed.
 */
async function overlayTextOnPdf(
  pdf: PDFDocument,
  fieldValues: Record<string, string>
): Promise<{ filled: string[]; skipped: string[] }> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const filled: string[] = [];
  const skipped: string[] = [];

  let page = pdf.getPages()[0] || pdf.addPage();
  let { height } = page.getSize();
  let yOffset = height - 50;

  for (const [label, value] of Object.entries(fieldValues)) {
    if (yOffset < 60) {
      page = pdf.addPage();
      height = page.getSize().height;
      yOffset = height - 50;
    }

    drawField(page, label, value, 50, yOffset, font, boldFont);
    yOffset -= 24;
    filled.push(label);
  }

  return { filled, skipped };
}

function drawField(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  boldFont: PDFFont
): void {
  page.drawText(`${label}:`, { x, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
  const labelWidth = boldFont.widthOfTextAtSize(`${label}: `, 10);
  page.drawText(value, { x: x + labelWidth, y, size: 10, font, color: rgb(0, 0, 0) });
}

/**
 * Auto-fill PDF by matching detected fields to profile data using the matching engine.
 */
export async function autoFillPdf(
  pdfBytes: Uint8Array,
  detectedFields: DetectedField[],
  profileFields: Record<string, string>,
  options?: { minScore?: number; flatten?: boolean }
): Promise<AutoFillResult> {
  const labels = detectedFields.map((f) => f.label);
  const profileKeys = Object.keys(profileFields);
  const { matched, unmatched } = matchAllFields(labels, profileKeys, options?.minScore ?? 0.6);

  const fieldValues: Record<string, string> = {};
  for (const m of matched) {
    fieldValues[m.detectedLabel] = profileFields[m.profileKey];
  }

  const result = await fillPdfForm(pdfBytes, fieldValues, { flatten: options?.flatten });
  return {
    ...result,
    matches: matched,
    unmatchedFields: unmatched,
  };
}

/**
 * Get metadata about a PDF (page count, form fields, etc.)
 */
export async function getPdfInfo(pdfBytes: Uint8Array): Promise<{
  pageCount: number;
  hasForm: boolean;
  formFields: Array<{ name: string; type: string }>;
  title: string | undefined;
  author: string | undefined;
  creationDate: Date | undefined;
}> {
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  return {
    pageCount: pdf.getPageCount(),
    hasForm: fields.length > 0,
    formFields: fields.map((f) => ({
      name: f.getName(),
      type: f.constructor.name.replace("PDF", "").replace("Field", "").toLowerCase(),
    })),
    title: pdf.getTitle(),
    author: pdf.getAuthor(),
    creationDate: pdf.getCreationDate(),
  };
}

/**
 * Create a new PDF with interactive form fields.
 * Handles pagination automatically.
 */
export async function createFormPdf(
  fields: Array<{ label: string; type: string }>,
  title?: string
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  if (title) pdf.setTitle(title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();

  let page = pdf.addPage();
  let { width, height } = page.getSize();
  let yOffset = height - 50;

  // Title
  if (title) {
    page.drawText(title, { x: 50, y: yOffset, size: 18, font: boldFont, color: rgb(0, 0, 0) });
    yOffset -= 40;
  }

  for (const field of fields) {
    if (yOffset < 60) {
      page = pdf.addPage();
      ({ width, height } = page.getSize());
      yOffset = height - 50;
    }

    page.drawText(field.label, { x: 50, y: yOffset, size: 10, font, color: rgb(0.2, 0.2, 0.2) });

    const textField = form.createTextField(field.label);
    textField.addToPage(page, {
      x: 200,
      y: yOffset - 5,
      width: width - 260,
      height: 20,
    });

    yOffset -= 35;
  }

  return pdf.save();
}

/**
 * Merge multiple PDFs into one document.
 */
export async function mergePdfs(pdfBuffers: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const buf of pdfBuffers) {
    const donor = await PDFDocument.load(buf);
    const pages = await merged.copyPages(donor, donor.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  return merged.save();
}

/**
 * Extract specific pages from a PDF.
 */
export async function extractPages(
  pdfBytes: Uint8Array,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdfBytes);
  const output = await PDFDocument.create();

  const indices = pageNumbers.map((n) => n - 1).filter((i) => i >= 0 && i < source.getPageCount());
  const pages = await output.copyPages(source, indices);
  for (const page of pages) {
    output.addPage(page);
  }

  return output.save();
}
