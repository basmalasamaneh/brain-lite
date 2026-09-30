# Brain Lite

A bilingual, mobile-first personal second brain for capturing text, photos, and PDFs, with backend-only Gemini extraction and manual review.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/brain-lite run dev` — frontend (use the managed workflow for its port/base-path environment)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- `GEMINI_API_KEY` — set only through Secrets; missing key saves an explicitly labeled plain-note fallback.
- `GEMINI_MODEL` — configurable Gemini model, defaults to `gemini-3.8-flash`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/brain-lite` — React/Vite frontend and app-local design system.
- `artifacts/api-server/src/routes` — memory, auth, and private attachment endpoints.
- `lib/db/src/schema` — PostgreSQL schema.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts.

## Architecture decisions

- The user chose a mobile-first React/Vite web app after initially selecting mobile output; do not switch to Expo.
- Capture extraction and Ask use the user's direct Gemini API key (not the Replit AI proxy). Ask answers only from the authenticated user's compact memory records with validated source IDs.
- AI confidence of 80 or higher auto-confirms; lower confidence and failed extraction require review. Preserve raw text and the original attachment regardless of extraction outcome.
- Only owned, size-checked attachments are sent to Google Gemini. The backend encodes PDFs and normalized images as inline base64 parts; the browser never receives a Gemini key.
- Personal captures require sign-in; anonymous visitors see read-only samples, not other users' content. This protects potentially sensitive documents without hiding the initial experience behind a login screen.
- File bytes live in private App Storage; PostgreSQL holds paths and ownership metadata.

## Product

Capture text, images, camera photos, and PDFs; review extracted fields and confidence; confirm or edit Brain Inbox items; download appointments as calendar files. English/Arabic with RTL and system/light/dark themes.

Ask provides source-linked answers; Daily Brief uses local-calendar rules without AI for today, the next 7 days, explicit expirations within 30 days, and recent saves. Settings offers theme/language controls and JSON export. Delete all data requires typing DELETE and removes the user's memories and owned uploads/files while retaining the login account.

## User preferences

Calm premium styling: warm off-white, indigo, lavender, generous spacing, rounded cards. Plus Jakarta Sans headings, Inter body, IBM Plex Sans Arabic for Arabic.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
