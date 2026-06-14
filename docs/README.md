# Flatmates — Shared Expenses Tracker

A full-stack web application for managing shared household expenses among flatmates, with support for multiple split types, currency conversion, CSV import with anomaly detection, and automatic debt-minimization settlement suggestions.

---

## Live App

Deployed via Replit at `https://<your-domain>.replit.app/`

---

## Features

### User Management
- Sign in / sign up via Google or email/password (Clerk Auth)
- Each user has a profile (name, email, avatar)

### Groups
- Create named groups (e.g. "Flat 4B")
- Time-bounded membership: each member has a `joined_at` date and optional `left_at` date
- Members who left a group are excluded from future expense splits

### Expenses
Five supported split types:

| Type | Description |
|------|-------------|
| **equal** | Divide equally among all selected members |
| **percentage** | Each member pays a stated % of the total |
| **exact** | Each member pays a specific stated amount |
| **share** | Divide proportionally by share count (e.g. 2:1:1) |
| **settlement** | Record a direct payment between two members |

- Currency: INR or USD; USD amounts are converted to INR using the latest saved exchange rate (default: 1 USD = 84 INR)
- All balances are maintained in INR

### Settlements
- Record payments between members
- "Suggested settlements" uses a debt-minimization algorithm (greedy creditor/debtor matching) to propose the fewest possible transactions to clear all debts

### CSV Import
- Upload `expenses_export.csv` via the web UI
- Two-step flow: **Preview** → **Confirm**
- The importer detects and reports 12+ categories of anomalies (see SCOPE.md for the full list)
- Each anomaly is reported with row number, description, severity, and action taken

### Balance & Stats
- Per-member net balance (total paid − total owed after settlements)
- Group-level stats: total spend, total settled, outstanding debt
- Activity feed showing recent expenses and settlements

### Exchange Rates
- Manual USD→INR rate management
- Rate history with effective dates

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS v4 + shadcn/ui |
| Auth | Clerk (Replit-managed) |
| API | Express 5 + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4 + drizzle-zod |
| API Contract | OpenAPI 3.1 + Orval codegen |
| Package manager | pnpm workspaces |

---

## Running Locally

```bash
# Install dependencies
pnpm install

# Push DB schema
pnpm --filter @workspace/db run push

# Start API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Start frontend (port 21345)
pnpm --filter @workspace/flatmates run dev
```

Required environment variable: `DATABASE_URL` (PostgreSQL connection string)

---

## Project Structure

```
artifacts/
  api-server/        Express API server
  flatmates/         React frontend
lib/
  api-client-react/  Generated React Query hooks (from OpenAPI)
  api-spec/          OpenAPI 3.1 specification
  api-zod/           Generated Zod schemas (from OpenAPI)
  db/                Drizzle ORM schema + migrations
docs/                Documentation files
```

---

## Assignment Files

- **SCOPE.md** — functional scope, what's in and out
- **DECISIONS.md** — architecture and design decisions
- **AI_USAGE.md** — how AI tools were used in development
- **sample_import.csv** — sample CSV for testing the import feature

---

## Default Data

The database is seeded with a default exchange rate of **1 USD = 84 INR** (effective 2026-01-01).

Group members referenced in the assignment (Aisha, Rohan, Priya, Meera, Sam, Dev) should be created by signing in and creating a group with those names added as members.
