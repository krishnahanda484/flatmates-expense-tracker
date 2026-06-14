# Flatmates — Architecture & Design Decisions

## 1. pnpm Workspaces Monorepo

**Decision:** Organise the project as a pnpm workspaces monorepo with separate packages for the API, frontend, DB schema, and API spec.

**Why:** The scaffold provided by the course/assignment already uses this pattern. It enforces clean separation between the backend (`api-server`), frontend (`flatmates`), and shared libraries (`db`, `api-spec`, `api-zod`, `api-client-react`). This means the generated Zod schemas and React Query hooks are type-safe end-to-end without any copy-paste.

**Trade-off:** Slightly more ceremony to add a new package, but the `tsc --build` composite setup ensures broken cross-package imports are caught at typecheck time.

---

## 2. Contract-First API Design (OpenAPI → Orval)

**Decision:** Define the entire API surface in `lib/api-spec/openapi.yaml` (OpenAPI 3.1), then generate Zod schemas and React Query hooks via Orval.

**Why:**
- A single source of truth for every request/response shape
- The server uses the generated Zod schemas for input validation → mismatches are caught before they reach business logic
- The frontend uses the generated hooks → no hand-rolling of fetch calls or response types

**Trade-off:** Every API change requires regenerating (`pnpm --filter @workspace/api-spec run codegen`), which adds a step. Accepted, because the type safety benefit outweighs the inconvenience.

---

## 3. Drizzle ORM over Prisma

**Decision:** Use Drizzle ORM with direct PostgreSQL queries for the data layer.

**Why:** Drizzle is the recommended ORM in the workspace scaffold. It produces SQL-like TypeScript, keeps the query surface small, and avoids the Prisma client binary weight. `drizzle-zod` auto-generates Zod insert/select schemas from the table definitions, reducing duplication between DB and API validation.

**Trade-off:** Less "magic" than Prisma (no auto-relations, no nested creates). Explicit joins are required, which is more verbose but more predictable.

---

## 4. All Balances in INR

**Decision:** Store and compute all group balances in INR. USD expenses are converted at insert time using the current exchange rate.

**Why:** Multi-currency balance sheets require keeping both a "native" and "reporting" currency per transaction, significantly complicating balance computation and settlement suggestions. For a flatmates app used in India, INR is the natural reporting currency.

**Trade-off:** If the USD/INR rate changes significantly, past balances are computed at the rate that was current when each expense was recorded — this is the correct accounting behaviour. The original currency and amount are also stored so the UI can display them.

---

## 5. Time-Bounded Membership (joined_at / left_at)

**Decision:** Group membership is represented as rows with `joined_at` and `left_at` timestamps rather than a simple member list.

**Why:** The assignment requirement is that a flatmate who leaves the group mid-way is not included in expenses added after their departure. A time-bounded membership record lets the server check "was this person an active member on the expense date?" without losing history.

**Trade-off:** Queries for "who are current members?" require a filter (`left_at IS NULL OR left_at > NOW()`). This is a small complexity cost for a significant correctness gain.

---

## 6. Greedy Debt-Minimization for Settlements

**Decision:** The "suggested settlements" endpoint implements a greedy creditor/debtor matching algorithm (also called the "cash-flow minimization" algorithm).

**Why:** In a group of N members with arbitrary balances, naive pairwise settlement can require O(N²) transactions. The greedy algorithm reduces this to at most N−1 transactions by always pairing the largest debtor with the largest creditor.

**Implementation:**
1. Compute each member's net balance (positive = creditor, negative = debtor)
2. Sort both lists by absolute value descending
3. Greedily match the largest debtor to the largest creditor; create a settlement for `min(|debt|, |credit|)`; update remaining balances; repeat

**Trade-off:** Not always globally optimal in degenerate cases, but optimal for typical small-group scenarios and significantly simpler than ILP-based exact minimization.

---

## 7. In-Memory Preview Sessions for CSV Import

**Decision:** CSV import uses a two-step preview/confirm flow. The preview result is stored in a server-side `Map<sessionToken, PreviewSession>` keyed by a random UUID; the confirm step references that token.

**Why:** The assignment requires showing the user a report of anomalies before committing. Sending the parsed rows back to the client and re-uploading on confirm is wasteful; storing them server-side is simpler. The token ensures the correct preview is confirmed (prevents CSRF-style accidental confirms of a different parse).

**Trade-off:** In a multi-instance deployment, the in-memory map would not be shared across instances. For a single-instance hobby app this is acceptable; for production, the session should be stored in Redis or the DB. Sessions expire after 10 minutes.

---

## 8. Clerk Auth (Replit-Managed)

**Decision:** Use Replit-managed Clerk for authentication.

**Why:** The assignment requires authenticated access. Clerk provides Google OAuth, email/password, and session management out of the box with zero backend infrastructure. The Replit-managed plan means no separate Clerk account is needed — the publishable key is injected at runtime.

**Trade-off:** Vendor lock-in to Clerk. Mitigated because the `users` table stores a `clerk_id` that could be replaced with any OIDC `sub` claim.

---

## 9. Shadcn/UI + Tailwind v4

**Decision:** Use shadcn/ui component library with Tailwind CSS v4 (`@tailwindcss/vite`).

**Why:** shadcn/ui provides accessible, composable primitives (dialogs, forms, tables, badges) without a heavy runtime dependency — components are copied directly into the codebase. Tailwind v4 with the Vite plugin gives the fastest HMR and smallest CSS output.

**Trade-off:** shadcn components must be manually updated if the upstream changes. Accepted because the components are stable and the copy-into-repo model is intentional.

---

## 10. CSV Anomaly Detection Strategy

**Decision:** Classify anomalies into ERROR (row is skipped) vs WARNING (row is imported with a flag) rather than rejecting the entire file on any error.

**Why:** A real-world CSV export from, e.g., a bank or a group messaging app will almost always have some dirty rows. Rejecting the whole file forces the user to fix every single issue before seeing any progress. The preview/confirm flow lets them see exactly what was skipped and why, and still import the clean majority.

**Trade-off:** Users may miss warnings and accidentally import rows they intended to fix. The UI displays the full anomaly report prominently to mitigate this.
