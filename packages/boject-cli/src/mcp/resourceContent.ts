export const BUNDLE_FORMAT_DOC = `# boject schema-as-code bundle format

A schema lives in \`content-types/schema.boject.json\` as a **bundle**:

\`\`\`jsonc
{
  "version": 2,            // must be 2
  "exportedAt": "2026-07-07T00:00:00.000Z", // ISO string
  "portable": true,        // boolean
  "contentTypes": [        // schema-only bundles omit "entries"
    {
      "id": null,          // null when authoring new
      "identifier": "Article",   // PascalCase, immutable
      "name": "Article",         // human label
      "description": null,
      "fields": [
        {
          "id": null,
          "identifier": "title",   // camelCase, unique within the type
          "name": "Title",
          "type": "ENTRY_TITLE",   // see the field-types resource
          "required": true,
          "unique": false,          // optional
          "order": 0,               // display order, 0-based
          "options": null           // type-specific; see field-types
        }
      ]
    }
  ]
}
\`\`\`

Every content type needs **exactly one** \`ENTRY_TITLE\` field and **at most one** \`SLUG\` field.
Validate a candidate with the \`validate_schema\` tool before writing the file.`;

export const FIELD_TYPES_DOC = `# Field types

| Type | Purpose | Required \`options\` |
|---|---|---|
| ENTRY_TITLE | The entry's title (exactly one per type). | — |
| SLUG | URL slug (at most one per type). | — |
| TEXT | Single-line text. | — |
| TEXTAREA | Multi-line plain text. | — |
| NUMBER | Numeric value. | — |
| BOOLEAN | True/false. | — |
| DATETIME | ISO date/time. | — |
| SELECT | One of a fixed set. | \`options.choices\`: non-empty string[] |
| RICHTEXT | Formatted rich text. | — |
| RELATION | Link to one entry of another type. | \`options.targetContentTypeIdentifiers\`: string[] |
| MULTIRELATION | Link to many entries of another type. | \`options.targetContentTypeIdentifiers\`: string[] |
| IMAGE | Uploaded image (metadata auto-populated). | — |

Notes:
- \`required\` and \`unique\` are booleans on every field (\`unique\` optional, default false).
- RELATION/MULTIRELATION \`targetContentTypeIdentifiers\` must name content types present in the same bundle (the \`validate_schema\` tool reports unknown targets).`;

export const IDENTIFIER_RULES_DOC = `# Identifier rules

- **Content-type identifiers** must be PascalCase: \`/^[A-Z][a-zA-Z0-9]*$/\` (e.g. \`Article\`, \`BlogPost\`). Immutable once created.
- **Field identifiers** must be camelCase: \`/^[a-z][a-zA-Z0-9]*$/\` (e.g. \`title\`, \`featuredImage\`). Unique within their content type.
- \`name\` is the free-text human label; \`identifier\` is the machine key.
- Casing is enforced server-side at \`schema apply\`; produce correct identifiers up front (the offline \`validate_schema\` tool checks shape and cross-references but not casing).`;
