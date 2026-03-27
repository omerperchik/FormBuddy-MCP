import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DetectedField } from "./ocr.js";

export interface FillResult {
  pdfBytes: Uint8Array;
  filledFields: string[];
  skippedFields: string[];
}

/**
 * Fill a PDF form's AcroForm fields with provided values.
 * Falls back to text overlay if no AcroForm fields are present.
 */
export async function fillPdfForm(
  pdfBytes: Uint8Array,
  fieldValues: Record<string, string>
): Promise<FillResult> {
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();
  const formFields = form.getFields();

  const filledFields: string[] = [];
  const skippedFields: string[] = [];

  if (formFields.length > 0) {
    // PDF has AcroForm fields — fill them directly
    for (const [key, value] of Object.entries(fieldValues)) {
      try {
        const field = form.getTextField(key);
        field.setText(value);
        filledFields.push(key);
      } catch {
        // Field not found or not a text field — try other types
        try {
          const checkbox = form.getCheckBox(key);
          if (value === "true" || value === "yes" || value === "1") {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
          filledFields.push(key);
        } catch {
          try {
            const dropdown = form.getDropdown(key);
            dropdown.select(value);
            filledFields.push(key);
          } catch {
            skippedFields.push(key);
          }
        }
      }
    }

    form.flatten();
  } else {
    // No AcroForm fields — use text overlay at detected positions
    const result = await overlayTextOnPdf(pdf, fieldValues);
    filledFields.push(...result.filled);
    skippedFields.push(...result.skipped);
  }

  const resultBytes = await pdf.save();
  return { pdfBytes: resultBytes, filledFields, skippedFields };
}

/**
 * Overlay text onto a PDF at approximate positions based on field labels.
 * Used when the PDF doesn't have AcroForm fields.
 */
async function overlayTextOnPdf(
  pdf: PDFDocument,
  fieldValues: Record<string, string>
): Promise<{ filled: string[]; skipped: string[] }> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const filled: string[] = [];
  const skipped: string[] = [];

  // Simple layout: place fields sequentially on the first page
  const page = pages[0];
  const { height } = page.getSize();
  let yOffset = height - 50;

  for (const [label, value] of Object.entries(fieldValues)) {
    if (yOffset < 50) {
      skipped.push(label);
      continue;
    }

    page.drawText(`${label}: ${value}`, {
      x: 50,
      y: yOffset,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });

    yOffset -= 20;
    filled.push(label);
  }

  return { filled, skipped };
}

/**
 * Fill PDF using detected fields and profile data.
 * Matches detected field labels to profile field keys.
 */
export async function autoFillPdf(
  pdfBytes: Uint8Array,
  detectedFields: DetectedField[],
  profileFields: Record<string, string>
): Promise<FillResult & { matchedFields: Array<{ detected: string; profile: string }> }> {
  const fieldValues: Record<string, string> = {};
  const matchedFields: Array<{ detected: string; profile: string }> = [];

  for (const detected of detectedFields) {
    const profileKey = findBestMatch(detected.label, Object.keys(profileFields));
    if (profileKey) {
      fieldValues[detected.label] = profileFields[profileKey];
      matchedFields.push({ detected: detected.label, profile: profileKey });
    }
  }

  const result = await fillPdfForm(pdfBytes, fieldValues);
  return { ...result, matchedFields };
}

/**
 * Simple fuzzy matching: find the best profile key for a detected field label.
 */
function findBestMatch(label: string, profileKeys: string[]): string | null {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Exact match
  for (const key of profileKeys) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized) {
      return key;
    }
  }

  // Common field aliases
  const aliases: Record<string, string[]> = {
    name: ["fullname", "full_name", "legal_name", "legalname"],
    firstname: ["first_name", "fname", "givenname", "given_name"],
    lastname: ["last_name", "lname", "surname", "familyname", "family_name"],
    email: ["emailaddress", "email_address", "e_mail"],
    phone: ["phonenumber", "phone_number", "telephone", "tel", "mobile"],
    address: ["streetaddress", "street_address", "address1", "address_line_1"],
    city: ["town"],
    state: ["province", "region"],
    zip: ["zipcode", "zip_code", "postalcode", "postal_code"],
    ssn: ["socialsecurity", "social_security", "socialsecuritynumber"],
    dob: ["dateofbirth", "date_of_birth", "birthday", "birthdate"],
    company: ["companyname", "company_name", "organization", "employer"],
  };

  for (const key of profileKeys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if label matches any alias of this key
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      const allVariants = [canonical, ...aliasList];
      if (allVariants.includes(normalized) && allVariants.includes(normalizedKey)) {
        return key;
      }
    }

    // Substring match
    if (normalized.includes(normalizedKey) || normalizedKey.includes(normalized)) {
      return key;
    }
  }

  return null;
}

/**
 * Extract text content from a PDF for field detection.
 */
export async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(pdfBytes);
  // pdf-lib doesn't support text extraction natively.
  // Return page count info; actual text extraction requires OCR on rendered pages.
  const pageCount = pdf.getPageCount();
  return `[PDF with ${pageCount} page(s) — use OCR for text extraction]`;
}

/**
 * Get metadata about a PDF (page count, form fields, etc.)
 */
export async function getPdfInfo(
  pdfBytes: Uint8Array
): Promise<{
  pageCount: number;
  hasForm: boolean;
  formFieldNames: string[];
  title: string | undefined;
  author: string | undefined;
}> {
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  return {
    pageCount: pdf.getPageCount(),
    hasForm: fields.length > 0,
    formFieldNames: fields.map((f) => f.getName()),
    title: pdf.getTitle(),
    author: pdf.getAuthor(),
  };
}

/**
 * Create a new blank PDF with form fields based on detected fields.
 */
export async function createFormPdf(
  fields: Array<{ label: string; type: string }>
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  const { width, height } = page.getSize();
  const form = pdf.getForm();

  let yOffset = height - 50;

  for (const field of fields) {
    if (yOffset < 50) {
      const newPage = pdf.addPage();
      yOffset = newPage.getSize().height - 50;
    }

    // Draw label
    page.drawText(field.label, {
      x: 50,
      y: yOffset,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });

    // Create form field
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
