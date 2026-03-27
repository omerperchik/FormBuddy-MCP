# FormBuddy MCP Server

An MCP (Model Context Protocol) server that exposes FormBuddy's AI-powered form filling capabilities to any MCP-compatible client — Claude, VS Code, and more.

## Features

- **Document Scanning** — OCR-powered field detection from images and PDFs
- **Form Filling** — Fill PDF forms (AcroForm + text overlay fallback)
- **Auto-Fill** — Match detected fields to user profiles automatically
- **Profile Management** — CRUD operations for personal, business, and family profiles
- **Template Library** — Browse and use common form templates
- **PDF Export** — Upload filled forms to Firebase Storage

## Tools

| Tool | Description |
|------|-------------|
| `form_scan` | Scan an image/PDF to detect form fields via OCR |
| `form_fill` | Fill a PDF form with provided field values |
| `form_detect_fields` | Analyze a PDF and return its form field names |
| `form_create` | Create a new PDF form with specified fields |
| `form_auto_fill` | Auto-fill a form by matching fields to a profile |
| `form_list_templates` | Browse the forms library |
| `form_get_template` | Get a specific form template |
| `profile_list` | List all profiles for a user |
| `profile_get` | Get a profile with all field data |
| `profile_create` | Create a new profile |
| `profile_update` | Update an existing profile |

## Setup

### Prerequisites

- Node.js 18+
- Firebase project (for cloud features)
- Google Cloud Vision API key (for OCR)

### Install

```bash
npm install
npm run build
```

### Environment Variables

```bash
# Required for cloud features
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Required for OCR (alternative to Application Default Credentials)
GOOGLE_CLOUD_VISION_API_KEY=your-api-key
```

### Run

```bash
npm start
```

### Configure in Claude Code

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
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

### Configure in Claude Desktop

Add to `claude_desktop_config.json`:

```json
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

## Example Usage

```
User: "Fill out this W-9 with my business profile"

Claude -> form_scan(content_base64: <PDF>)
       <- { formFields: ["name", "business_name", "tax_id", ...] }

Claude -> form_auto_fill(profile_id: "business", content_base64: <PDF>)
       <- { filledCount: 12, skippedCount: 1, downloadUrl: "https://..." }
```

## Architecture

```
src/
├── index.ts              # MCP server entry point
├── tools/
│   ├── documents.ts      # Document scanning, filling, templates
│   ├── profiles.ts       # Profile CRUD
│   └── autofill.ts       # Intelligent auto-fill
└── services/
    ├── firebase.ts       # Firebase Admin (Firestore, Storage, Auth)
    ├── ocr.ts            # Google Cloud Vision OCR + field detection
    └── pdf.ts            # PDF manipulation (pdf-lib)
```

## License

MIT
