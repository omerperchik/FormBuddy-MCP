/**
 * Centralized configuration with environment validation and graceful degradation.
 *
 * The server operates in three modes:
 *   1. Full mode — Firebase + Cloud Vision configured → all features available
 *   2. Cloud mode — Firebase only → profiles, templates, storage (no OCR)
 *   3. Local mode — no cloud services → PDF manipulation + local OCR only
 */

export interface Config {
  firebase: {
    enabled: boolean;
    projectId: string | null;
    storageBucket: string | null;
  };
  ocr: {
    provider: "cloud-vision" | "none";
    apiKey: string | null;
  };
  server: {
    name: string;
    version: string;
    logLevel: "debug" | "info" | "warn" | "error";
  };
}

export function loadConfig(): Config {
  const projectId = process.env.FIREBASE_PROJECT_ID || null;
  const hasCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const visionApiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY || null;

  return {
    firebase: {
      enabled: !!projectId && (hasCredentials || !!process.env.FIREBASE_EMULATOR_HOST),
      projectId,
      storageBucket: projectId ? `${projectId}.firebasestorage.app` : null,
    },
    ocr: {
      provider: visionApiKey || hasCredentials ? "cloud-vision" : "none",
      apiKey: visionApiKey,
    },
    server: {
      name: "FormBuddy",
      version: "2.0.0",
      logLevel: (process.env.LOG_LEVEL as Config["server"]["logLevel"]) || "info",
    },
  };
}

export function describeMode(config: Config): string {
  if (config.firebase.enabled && config.ocr.provider !== "none") {
    return "full (Firebase + Cloud Vision)";
  }
  if (config.firebase.enabled) {
    return "cloud (Firebase only — OCR disabled)";
  }
  return "local (PDF tools only — no cloud services)";
}

/** Check whether a feature requires Firebase and return a user-friendly error if not configured. */
export function requireFirebase(config: Config): string | null {
  if (config.firebase.enabled) return null;
  return "This operation requires Firebase. Set FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS environment variables.";
}

export function requireOCR(config: Config): string | null {
  if (config.ocr.provider !== "none") return null;
  return "OCR is not configured. Set GOOGLE_CLOUD_VISION_API_KEY or GOOGLE_APPLICATION_CREDENTIALS to enable document scanning.";
}
