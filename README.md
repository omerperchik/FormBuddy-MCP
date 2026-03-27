# FormBuddy MCP Server

A production-grade [Model Context Protocol](https://modelcontextprotocol.io) server that brings AI-powered form filling to any MCP client — Claude, VS Code, and beyond.

Scan documents, detect fields, auto-fill from profiles, and export completed PDFs — all through natural language.

## Highlights

- **14 tools** — document scanning, form filling, profile management, PDF manipulation
- **5 resources** — browse profiles and templates as addressable URIs
- **4 prompts** — guided workflows for common form-filling scenarios
- **Intelligent matching** — Levenshtein distance + alias resolution across 25+ canonical field types
- **Three operating modes** — works locally with just PDFs, or scales up with Firebase + Cloud Vision
- **Graceful degradation** — every cloud feature fails with a clear message, never a crash

## Quick Start

```bash
# Clone and build
git clone https://github.com/omerperchik/FormBuddy-MCP.git
cd FormBuddy-MCP
npm install && npm run build

# Run (local mode — PDF tools only, no cloud required)
npm start
```

### Add to Claude Code

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "formbuddy": {
      "command": "node",
      "args": ["/path/to/FormBuddy-MCP/dist/index.js"],
      "env": {
        "FIREBASE_PROJECT_ID": "your-project-id",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json",
        "GOOGLE_CLOUD_VISION_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Add to Claude Desktop

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "formbuddy": {
      "command": "node",
      "args": ["/path/to/FormBuddy-MCP/dist/index.js"],
      "env": {
        "FIREBASE_PROJECT_ID": "your-project-id",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
      }
    }
  }
}
```

## Operating Modes

The server adapts to what's configured:

| Mode | Requirements | Available Features |
|------|-------------|-------------------|
| **Full** | Firebase + Cloud Vision | Everything: OCR, profiles, templates, storage, auto-fill |
| **Cloud** | Firebase only | Profiles, templates, storage, PDF tools (no OCR) |
| **Local** | Nothing | PDF inspection, form filling, creation, merge, page extraction |

## Tools

### Document Tools

| Tool | Description |
|------|-------------|
| `form_scan` | Scan image/PDF → detect fields via OCR or AcroForm inspection |
| `form_fill` | Fill a PDF with specific field values (AcroForm + text overlay fallback) |
| `form_detect_fields` | Inspect PDF structure → field names, types, metadata |
| `form_create` | Create a new interactive PDF form from scratch |
| `pdf_merge` | Combine multiple PDFs into one document |
| `pdf_extract_pages` | Pull specific pages out of a PDF |
| `form_list_templates` | Browse the forms library (filter by category or search) |
| `form_get_template` | Download a specific form template |

### Profile Tools

| Tool | Description |
|------|-------------|
| `profile_list` | List all profiles for a user |
| `profile_get` | Get a profile with all field data |
| `profile_create` | Create a new profile (personal/business/family) |
| `profile_update` | Update profile fields (merge, not replace) |
| `profile_delete` | Permanently delete a profile |

### Auto-Fill

| Tool | Description |
|------|-------------|
| `form_auto_fill` | One-shot: scan → match → fill using intelligent field matching |

## Resources

Browse FormBuddy data as addressable URIs:

```
formbuddy://profiles/{userId}                → all profiles for a user
formbuddy://profiles/{userId}/{profileId}    → single profile with fields
formbuddy://templates                        → all form templates
formbuddy://templates/{category}             → templates by category
formbuddy://templates/detail/{templateId}    → single template metadata
```

## Prompts

Pre-built guided workflows:

| Prompt | Description |
|--------|-------------|
| `fill-form` | Step-by-step: scan → match → fill → review → complete |
| `setup-profile` | Interactive profile creation (collects info field by field) |
| `batch-fill` | Fill multiple forms with the same profile |
| `review-form` | Scan a filled form and check for completeness |

## Field Matching Engine

Auto-fill uses a multi-pass matching strategy with scored results:

1. **Exact match** (score: 1.0) — normalized strings are identical
2. **Alias resolution** (score: 0.95) — maps 25+ canonical fields across 150+ variants (e.g., `dob` ↔ `date_of_birth` ↔ `birthday`)
3. **Edit distance** (score: 0.6–0.94) — Levenshtein similarity for typos and variations
4. **Substring containment** (score: 0.6–0.85) — partial matches as a fallback

Each match reports its method and confidence score. Configurable threshold via `min_confidence` parameter.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_PROJECT_ID` | For cloud mode | Firebase project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | For cloud mode | Path to service account JSON |
| `GOOGLE_CLOUD_VISION_API_KEY` | For OCR | Cloud Vision API key (alternative to ADC) |
| `FIREBASE_EMULATOR_HOST` | For development | Connect to Firebase emulator |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

## Architecture

```
src/
├── index.ts                 # Server entry point
├── config.ts                # Environment validation + mode detection
├── errors.ts                # Structured MCP error responses
├── resources.ts             # MCP Resources (browsable URIs)
├── prompts.ts               # MCP Prompts (guided workflows)
├── tools/
│   ├── documents.ts         # 8 document/PDF tools
│   ├── profiles.ts          # 5 profile CRUD tools
│   └── autofill.ts          # Auto-fill orchestration
└── services/
    ├── firebase.ts          # Firestore, Storage, Auth
    ├── ocr.ts               # Cloud Vision OCR + field detection heuristics
    ├── pdf.ts               # pdf-lib: fill, create, merge, extract
    └── matching.ts          # Levenshtein + alias field matching engine
```

## Example

```
User: "Fill out this W-9 with my business profile"

Claude → form_scan(content_base64: <W-9 PDF>)
       ← { documentType: "pdf_interactive", formFields: [{name: "name", type: "text"}, ...], fieldCount: 15 }

Claude → form_auto_fill(profile_id: "biz-001", content_base64: <W-9 PDF>)
       ← { filledCount: 13, unmatchedFields: ["signature", "date"],
            matches: [
              { formField: "name", profileField: "company", confidence: 0.95, method: "alias" },
              { formField: "business_name", profileField: "businessName", confidence: 1.0, method: "exact" },
              ...
            ],
            pdf_base64: "..." }

Claude → "Filled 13 of 15 fields. 'signature' and 'date' need your input."
```

## License

MIT
