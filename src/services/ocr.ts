import sharp from "sharp";

export interface DetectedField {
  label: string;
  type: "text" | "date" | "number" | "checkbox" | "signature" | "ssn" | "phone" | "email";
  value: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OCRResult {
  fullText: string;
  fields: DetectedField[];
  pageCount: number;
}

const FIELD_PATTERNS: Array<{
  pattern: RegExp;
  type: DetectedField["type"];
  labelHint: string;
}> = [
  { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/, type: "ssn", labelHint: "SSN" },
  { pattern: /\b\d{2}[/-]\d{2}[/-]\d{4}\b/, type: "date", labelHint: "Date" },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: "email", labelHint: "Email" },
  { pattern: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, type: "phone", labelHint: "Phone" },
  { pattern: /\$[\d,]+\.?\d*/, type: "number", labelHint: "Amount" },
  { pattern: /\bsignature\b/i, type: "signature", labelHint: "Signature" },
  { pattern: /\b(yes|no)\b|\[[ x]\]/i, type: "checkbox", labelHint: "Checkbox" },
];

/**
 * Preprocess image for better OCR results.
 */
export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

/**
 * Analyze text to detect form fields using pattern matching.
 * This works with any OCR provider's raw text output.
 */
export function detectFieldsFromText(text: string): DetectedField[] {
  const fields: DetectedField[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for label: value patterns (e.g., "Name: John Doe")
    const labelValueMatch = line.match(/^([A-Za-z\s]+?):\s*(.+)$/);
    if (labelValueMatch) {
      const [, label, value] = labelValueMatch;
      const fieldType = inferFieldType(label, value);
      fields.push({
        label: label.trim(),
        type: fieldType,
        value: value.trim(),
        confidence: 0.8,
        boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
      });
      continue;
    }

    // Check for empty fields with underscores or lines (e.g., "Name: ___________")
    const emptyFieldMatch = line.match(/^([A-Za-z\s]+?):\s*[_\-\.]{3,}$/);
    if (emptyFieldMatch) {
      const label = emptyFieldMatch[1].trim();
      fields.push({
        label,
        type: inferFieldType(label, ""),
        value: "",
        confidence: 0.9,
        boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
      });
      continue;
    }

    // Check for known patterns within the line
    for (const { pattern, type, labelHint } of FIELD_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        fields.push({
          label: labelHint,
          type,
          value: match[0],
          confidence: 0.7,
          boundingBox: { x: 0, y: i * 20, width: 500, height: 20 },
        });
      }
    }
  }

  return fields;
}

function inferFieldType(label: string, value: string): DetectedField["type"] {
  const l = label.toLowerCase();
  if (l.includes("date") || l.includes("dob") || l.includes("birth")) return "date";
  if (l.includes("email") || l.includes("e-mail")) return "email";
  if (l.includes("phone") || l.includes("tel") || l.includes("mobile")) return "phone";
  if (l.includes("ssn") || l.includes("social security")) return "ssn";
  if (l.includes("signature") || l.includes("sign")) return "signature";
  if (l.includes("amount") || l.includes("total") || l.includes("salary")) return "number";

  // Infer from value
  for (const { pattern, type } of FIELD_PATTERNS) {
    if (pattern.test(value)) return type;
  }

  return "text";
}

/**
 * Call Google Cloud Vision API for OCR.
 * Requires GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CLOUD_VISION_API_KEY.
 */
export async function performOCR(imageBuffer: Buffer): Promise<OCRResult> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;

  if (apiKey) {
    return performOCRWithAPIKey(imageBuffer, apiKey);
  }

  // Fallback: use Application Default Credentials via REST
  return performOCRWithADC(imageBuffer);
}

async function performOCRWithAPIKey(
  imageBuffer: Buffer,
  apiKey: string
): Promise<OCRResult> {
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
            features: [
              { type: "TEXT_DETECTION" },
              { type: "DOCUMENT_TEXT_DETECTION" },
            ],
          },
        ],
      }),
    }
  );

  const data = (await response.json()) as {
    responses: Array<{
      fullTextAnnotation?: { text: string; pages: unknown[] };
    }>;
  };

  const annotation = data.responses?.[0]?.fullTextAnnotation;
  const fullText = annotation?.text || "";
  const fields = detectFieldsFromText(fullText);

  return {
    fullText,
    fields,
    pageCount: annotation?.pages?.length || 1,
  };
}

async function performOCRWithADC(imageBuffer: Buffer): Promise<OCRResult> {
  // When using ADC, the token is obtained from the metadata server or local credentials
  const { GoogleAuth } = await import("google-auth-library" as string).catch(
    () => ({ GoogleAuth: null })
  );

  if (!GoogleAuth) {
    // Fallback: return raw field detection without Cloud Vision
    return {
      fullText: "[OCR unavailable — configure GOOGLE_CLOUD_VISION_API_KEY or google-auth-library]",
      fields: [],
      pageCount: 1,
    };
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-vision"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const base64Image = imageBuffer.toString("base64");

  const response = await fetch(
    "https://vision.googleapis.com/v1/images:annotate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.token}`,
      },
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

  const data = (await response.json()) as {
    responses: Array<{
      fullTextAnnotation?: { text: string; pages: unknown[] };
    }>;
  };

  const annotation = data.responses?.[0]?.fullTextAnnotation;
  const fullText = annotation?.text || "";
  const fields = detectFieldsFromText(fullText);

  return { fullText, fields, pageCount: annotation?.pages?.length || 1 };
}
