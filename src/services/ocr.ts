import sharp from "sharp";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FieldType = "text" | "date" | "number" | "checkbox" | "signature" | "ssn" | "phone" | "email" | "address" | "currency";

export interface DetectedField {
  label: string;
  type: FieldType;
  value: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface OCRResult {
  fullText: string;
  fields: DetectedField[];
  pageCount: number;
  provider: "cloud-vision" | "local-heuristic";
}

// ── Field detection patterns ──
// Ordered by specificity (most specific first) to avoid false positives.

const FIELD_PATTERNS: Array<{
  pattern: RegExp;
  type: FieldType;
  labelHint: string;
  confidence: number;
}> = [
  { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/, type: "ssn", labelHint: "SSN", confidence: 0.9 },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, type: "email", labelHint: "Email", confidence: 0.92 },
  { pattern: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, type: "phone", labelHint: "Phone", confidence: 0.85 },
  { pattern: /\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b/, type: "date", labelHint: "Date", confidence: 0.88 },
  { pattern: /\$\s?[\d,]+\.?\d{0,2}/, type: "currency", labelHint: "Amount", confidence: 0.87 },
  { pattern: /\bsignature\b/i, type: "signature", labelHint: "Signature", confidence: 0.95 },
  { pattern: /\b(yes|no)\b|\[[ xX✓✗]\]/i, type: "checkbox", labelHint: "Checkbox", confidence: 0.8 },
];

// ── Label → type inference ──

const LABEL_TYPE_MAP: Array<{ keywords: string[]; type: FieldType }> = [
  { keywords: ["date", "dob", "birth", "expir"], type: "date" },
  { keywords: ["email", "e-mail", "electronic mail"], type: "email" },
  { keywords: ["phone", "tel", "mobile", "cell", "fax"], type: "phone" },
  { keywords: ["ssn", "social security", "tax id", "tin", "ein"], type: "ssn" },
  { keywords: ["signature", "sign here", "authorized sign"], type: "signature" },
  { keywords: ["amount", "total", "salary", "wage", "income", "price", "cost", "fee"], type: "currency" },
  { keywords: ["address", "street", "apt", "suite", "city", "state", "zip", "postal"], type: "address" },
  { keywords: ["number", "count", "qty", "quantity", "age", "years"], type: "number" },
];

function inferFieldType(label: string, value: string): FieldType {
  const l = label.toLowerCase();

  for (const { keywords, type } of LABEL_TYPE_MAP) {
    if (keywords.some((kw) => l.includes(kw))) return type;
  }

  // Infer from value using patterns
  for (const { pattern, type } of FIELD_PATTERNS) {
    if (pattern.test(value)) return type;
  }

  return "text";
}

/**
 * Preprocess image for optimal OCR.
 * Converts to grayscale, normalizes contrast, sharpens, and scales if needed.
 */
export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  let pipeline = sharp(buffer).grayscale().normalize().sharpen();

  // Scale up small images for better OCR
  if (metadata.width && metadata.width < 1000) {
    pipeline = pipeline.resize({ width: 2000, withoutEnlargement: false });
  }

  // Scale down very large images to avoid API limits
  if (metadata.width && metadata.width > 4000) {
    pipeline = pipeline.resize({ width: 4000, withoutEnlargement: true });
  }

  return pipeline.toBuffer();
}

/**
 * Detect form fields from raw OCR text using structural heuristics.
 * Works independently of any OCR provider.
 */
export function detectFieldsFromText(text: string): DetectedField[] {
  const fields: DetectedField[] = [];
  const lines = text.split("\n");
  const seen = new Set<string>(); // Deduplicate by label

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 2) continue;

    // Pattern 1: "Label: Value" or "Label : Value"
    const labelValueMatch = line.match(/^([A-Za-z][A-Za-z\s./#-]{1,40}?)\s*:\s*(.+)$/);
    if (labelValueMatch) {
      const label = labelValueMatch[1].trim();
      const value = labelValueMatch[2].trim();
      if (!seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        fields.push({
          label,
          type: inferFieldType(label, value),
          value,
          confidence: 0.85,
          boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
        });
      }
      continue;
    }

    // Pattern 2: "Label: ___" or "Label: ----" (empty fields)
    const emptyFieldMatch = line.match(/^([A-Za-z][A-Za-z\s./#-]{1,40}?)\s*:\s*[_\-\.]{3,}$/);
    if (emptyFieldMatch) {
      const label = emptyFieldMatch[1].trim();
      if (!seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        fields.push({
          label,
          type: inferFieldType(label, ""),
          value: "",
          confidence: 0.9,
          boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
        });
      }
      continue;
    }

    // Pattern 3: Standalone label line followed by a blank/underscore line
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/^[A-Za-z][A-Za-z\s./#-]{1,40}$/.test(line) && /^[_\-\.]{3,}$/.test(nextLine)) {
        if (!seen.has(line.toLowerCase())) {
          seen.add(line.toLowerCase());
          fields.push({
            label: line,
            type: inferFieldType(line, ""),
            value: "",
            confidence: 0.82,
            boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
          });
        }
        continue;
      }
    }

    // Pattern 4: Known value patterns in free text
    for (const { pattern, type, labelHint, confidence } of FIELD_PATTERNS) {
      const match = line.match(pattern);
      if (match && !seen.has(`${labelHint}_${match[0]}`)) {
        seen.add(`${labelHint}_${match[0]}`);
        fields.push({
          label: labelHint,
          type,
          value: match[0],
          confidence,
          boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
        });
      }
    }
  }

  return fields;
}

/**
 * Perform OCR on an image buffer.
 * Uses Google Cloud Vision API if configured, otherwise returns a helpful error.
 */
export async function performOCR(
  imageBuffer: Buffer,
  apiKey: string | null
): Promise<OCRResult> {
  if (apiKey) {
    return performOCRWithAPIKey(imageBuffer, apiKey);
  }

  // Fallback: try Application Default Credentials
  return performOCRWithADC(imageBuffer);
}

async function performOCRWithAPIKey(imageBuffer: Buffer, apiKey: string): Promise<OCRResult> {
  const base64Image = imageBuffer.toString("base64");

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Image },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Cloud Vision API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    responses: Array<{
      fullTextAnnotation?: { text: string; pages: unknown[] };
      error?: { message: string };
    }>;
  };

  if (data.responses?.[0]?.error) {
    throw new Error(`Cloud Vision: ${data.responses[0].error.message}`);
  }

  const annotation = data.responses?.[0]?.fullTextAnnotation;
  const fullText = annotation?.text || "";
  const fields = detectFieldsFromText(fullText);

  return {
    fullText,
    fields,
    pageCount: annotation?.pages?.length || 1,
    provider: "cloud-vision",
  };
}

async function performOCRWithADC(imageBuffer: Buffer): Promise<OCRResult> {
  try {
    const mod = await import("google-auth-library");
    const auth = new mod.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-vision"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    const base64Image = imageBuffer.toString("base64");
    const response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenResponse.token}`,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Image },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloud Vision API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      responses: Array<{
        fullTextAnnotation?: { text: string; pages: unknown[] };
      }>;
    };

    const annotation = data.responses?.[0]?.fullTextAnnotation;
    const fullText = annotation?.text || "";
    const fields = detectFieldsFromText(fullText);

    return { fullText, fields, pageCount: annotation?.pages?.length || 1, provider: "cloud-vision" };
  } catch {
    throw new Error(
      "OCR unavailable. Set GOOGLE_CLOUD_VISION_API_KEY or install google-auth-library with GOOGLE_APPLICATION_CREDENTIALS."
    );
  }
}
