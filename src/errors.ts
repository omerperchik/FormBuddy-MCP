/**
 * Structured MCP error responses.
 * Every tool error flows through here so LLMs get consistent, actionable feedback.
 */

export type ErrorCode =
  | "NOT_FOUND"
  | "ACCESS_DENIED"
  | "INVALID_INPUT"
  | "MISSING_CONFIG"
  | "OCR_FAILED"
  | "PDF_ERROR"
  | "FIREBASE_ERROR"
  | "UNSUPPORTED";

export interface McpErrorResponse {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

export function mcpError(code: ErrorCode, message: string, details?: Record<string, unknown>): McpErrorResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: code, message, ...details }),
      },
    ],
    isError: true,
  };
}

export function mcpSuccess(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}
