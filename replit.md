# Brain Lite

A bilingual, mobile-first personal second brain for capturing text, photos, and PDFs, with backend-only Gemini extraction and manual review.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/brain-lite run dev` — frontend (use the managed workflow for its port/base-path environment)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/brain-lite test:graph` — deterministic Life Graph interaction/render regression gate; coverage and browser/device limits in `artifacts/brain-lite/tests/GRAPH_REGRESSIONS.md`
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- `GEMINI_API_KEY` — set only through Secrets; missing key saves an explicitly labeled plain-note fallback.
- `GEMINI_MODEL` — configurable Gemini model, defaults to `gemini-3.1-flash-lite`. Verify both structured capture extraction and grounded Ask with synthetic content before switching models; a model listing alone does not establish usability.

## Voice and mobile/PWA safeguards

- Voice capture supports English, Arabic, and mixed speech, with a two-minute / 5 MiB limit. Keep recordings off by default. Never invent a transcript when transcription fails; plain-note recovery requires explicit user action.
- Treat microphone streams and recording blobs as ephemeral: release tracks on stop, cancel, backgrounding, and unmount. Do not add an offline recording queue without explicit product approval.
- Retained recordings must remain private, owned, and discoverable for account/data deletion, including uncertain upload outcomes. Preserve upload metadata when remote cleanup cannot be confirmed.
- The production-only service worker caches only versioned static assets and a neutral bilingual offline page. Never cache API responses, private memories, uploads, audio, or authenticated page responses. Installation should be checked from the published standalone site, not the editor iframe.
- Preserve safe areas, 16px mobile inputs, keyboard-aware forms, and the 44px touch-target minimum in future UI work.

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
- Every app page and API endpoint requires email/password authentication except login/signup. Replit OIDC has been removed. Sessions use express-session/connect-pg-simple and SESSION_SECRET; passwords use bcrypt cost 12.
- Each signup receives five owned sample memories with an explicit sample flag; removing samples never removes ordinary memories. Anonymous visitors see login, not shared sample data.
- File bytes live in private App Storage; PostgreSQL holds paths and ownership metadata.

## Product

Capture text, images, camera photos, and PDFs; review extracted fields and confidence; confirm or edit Brain Inbox items; download appointments as calendar files. English/Arabic with RTL and system/light/dark themes.

Ask provides source-linked answers; Daily Brief uses local-calendar rules without AI for today, the next 7 days, explicit expirations within 30 days, and recent saves. Settings offers theme/language controls and JSON export. Delete all data requires typing DELETE and removes the user's memories and owned uploads/files while retaining the login account.

Settings also persists profile name/language/theme, changes passwords, and offers a separate permanent account deletion requiring DELETE plus the current password. New accounts get skippable three-screen onboarding.

The development data was reset with explicit user approval during the email-auth migration. Never repeat that reset automatically. The schema migration in lib/db/migrations/0001_email_auth.sql is non-destructive and rerunnable after the initial cutover.

## User preferences

Formal gold styling: warm ivory light mode, luxury black dark mode, gold accents, subtle eight-point-star ornaments, generous spacing, rounded cards. Cormorant Garamond/Amiri headings and Inter/IBM Plex Sans Arabic body fonts. Keep palette tokens centralized and honor reduced motion, AA text contrast, and RTL layouts.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
