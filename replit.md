# Flatmates — Shared Expenses Tracker

A full-stack web app for managing shared household expenses among flatmates, with Clerk auth, 5 split types, USD/INR conversion, CSV import with anomaly detection, and automatic settlement suggestions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, path `/api`)
- `pnpm --filter @workspace/flatmates run dev` — run the frontend (port 21345, path `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild composite lib declarations (run after schema changes)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + `@clerk/express` (auth middleware)
- DB: PostgreSQL + Drizzle ORM (8 tables)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Auth: Clerk v6 (`@clerk/react` + `@clerk/express`)
- API codegen: Orval (from OpenAPI 3.1 spec)
- Frontend: React 19 + Vite + Tailwind v4 + shadcn/ui
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — DB schema (source of truth for all tables)
- `lib/api-spec/openapi.yaml` — OpenAPI 3.1 spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit)
- `artifacts/api-server/src/routes/` — Express route handlers (7 files)
- `artifacts/flatmates/src/pages/` — React page components (9 pages)
- `artifacts/flatmates/src/components/` — shared UI components
- `docs/` — documentation (README, SCOPE.md, DECISIONS.md, AI_USAGE.md, sample_import.csv)

## Architecture decisions

- **Contract-first API**: OpenAPI spec → Orval → Zod schemas + React Query hooks. Any API change requires `codegen`.
- **INR-only balances**: USD amounts converted at insert time using the current exchange rate (default 84). Original amount + currency also stored.
- **Time-bounded membership**: `memberships.joined_at` / `left_at` — active member filter on all expense queries.
- **In-memory CSV preview sessions**: `Map<token, ParsedRows>` with 10-min TTL. Not multi-instance safe.
- **Greedy debt minimization**: `GET /api/groups/:id/settlements/suggested` — O(N log N) algorithm, ≤ N−1 transactions.

## Product

- Dashboard: list all groups, net balance across all groups
- Group detail: per-member balances, expense list, settlement list, activity feed, suggested settlements
- 5 split types: equal / percentage / exact / share / settlement
- CSV import: 2-step preview → confirm, with 12+ anomaly categories
- Exchange rate management (manual USD→INR entry)
- Clerk auth: Google OAuth + email/password

## User preferences

_None recorded yet._

## Gotchas

- After editing `lib/db/src/schema/`, run `pnpm run typecheck:libs` before leaf package checks — stale declarations cause `TS2305: no exported member` errors.
- Frontend hooks drop the `{ query: { enabled: ... } }` wrapper — the Orval-generated hooks already include `enabled: !!(id)` internally. Pass bare options only.
- `UserButton` in `@clerk/react` v6 does not accept `afterSignOutUrl` — remove it; the App.tsx `<Show>` handles post-signout redirect.
- Do NOT run `pnpm dev` at workspace root — use the workflows.
- CSS import order in `index.css`: `@layer theme, base, clerk, components, utilities;` must come before `@import 'tailwindcss'` (Tailwind v4 + Clerk).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `docs/SCOPE.md` for anomaly detection spec and split type rules
- See `docs/DECISIONS.md` for architecture rationale
- See `docs/sample_import.csv` for a test CSV with 12+ deliberate anomalies
