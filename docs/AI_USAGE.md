# AI Usage Disclosure

This document describes how AI-assisted tools were used during the development of the Flatmates shared expenses app, including concrete cases where the AI produced incorrect output and how it was caught and corrected.

---

## Tools Used

| Tool | Version | Purpose |
|------|---------|---------|
| Replit AI Agent (Claude Sonnet 4.5) | June 2026 | Primary development assistant — code generation, debugging, documentation |

---

## What AI Generated

### High AI Contribution (boilerplate and scaffolding)

- **Database schema** (`lib/db/src/schema/`): All eight table definitions generated from natural-language requirements
- **API route handlers** (`artifacts/api-server/src/routes/`): Full Express route files for groups, expenses, settlements, balances, exchange rates, and import
- **Frontend pages** (`artifacts/flatmates/src/pages/`): All nine page components generated from UI wireframe descriptions
- **OpenAPI spec** (`lib/api-spec/openapi.yaml`): Full API spec generated from route descriptions; used to auto-generate Zod schemas and React Query hooks
- **Documentation** (README, SCOPE.md, DECISIONS.md, this file): Structured from bullet-point descriptions

### Medium AI Contribution (logic with direction)

- **Greedy debt-minimization** (`settlements.ts`): Algorithm described in plain English; AI wrote TypeScript implementation
- **CSV anomaly detection** (`import.ts`): 19-anomaly categories specified as a table; AI implemented the detection logic
- **USD→INR conversion**: Requirement stated; AI chose correct placement (at insert time, storing both original and INR values)
- **Time-bounded membership queries**: Filtering logic generated after specifying the `joined_at`/`left_at` model

### Low/No AI Contribution (developer decisions)

- All architectural choices (pnpm workspaces, Drizzle ORM, contract-first OpenAPI, Clerk auth, INR-only balances, greedy settlement algorithm)
- Which CSV anomalies to detect and their severity classifications
- The decision to treat negative amounts as refunds (not errors)
- The decision to import both conflicting Thalassa rows (rather than picking one)
- The decision to let `Priya S` match `Priya` via partial matching rather than rejecting the row

---

## Key Prompts Used

1. "Build a shared expenses app for flatmates Aisha, Rohan, Priya, Meera, Sam, Dev. Requirements: Clerk auth, groups with time-bounded membership, expenses with 5 split types (equal/percentage/exact/share/settlement), USD/INR conversion, relational DB with Drizzle ORM."

2. "Write the CSV import route. The CSV has columns: date, description, paid_by, amount, currency, split_type, split_with, split_details, notes. Detect these specific anomalies: [provided the 19-row table from SCOPE.md]."

3. "The duplicate detection is missing Row 6 (Marina Bites) — the descriptions differ ('Dinner at Marina Bites' vs 'dinner - marina bites') so the description-strip comparison fails. Fix isDuplicate to also catch same-date + same-payer + same-amount even with different descriptions."

4. "Add conflict detection: if two rows on the same date share a common keyword ≥ 6 characters in their descriptions, have different payers, and amounts within 20% — flag both as potentially conflicting entries."

---

## Cases Where the AI Was Wrong

### Case 1: Wrong Clerk version installed

**What happened:** The AI installed `@clerk/react@5.54.0` when the project needed `@clerk/react@6.x`. This caused a runtime package conflict — `@clerk/react@5.x` requires `@clerk/shared@4.x` but `@clerk/express` (pulled in via the API server) had already installed `@clerk/shared@3.x`. The frontend failed to build.

**How I caught it:** The frontend workflow showed a dependency resolution error; inspecting `node_modules/.pnpm` revealed mismatched versions. The `RUNTIME_ERROR` in the browser console pointed to a hooks-related failure that only makes sense if Clerk's internal context was broken.

**What I changed:** Manually ran `pnpm --filter @workspace/flatmates add @clerk/react@^6` to force the correct version, removed a stale `@clerk/react>@clerk/shared` pnpm override that the AI had added as a workaround, then restarted the frontend workflow.

---

### Case 2: `<FormLabel>` used outside `<FormField>` — runtime crash

**What happened:** The AI generated two pages (`new-expense.tsx` and `new-group.tsx`) where `<FormLabel>` was rendered as a standalone section header, outside any `<FormField>` wrapper. The shadcn/ui `FormLabel` component calls `useFormField()` internally, which reads from a React context that only exists inside `<FormField>`'s render prop. React threw a hard crash as soon as either page was navigated to.

**How I caught it:** The Vite workflow log showed `[RUNTIME_ERROR]` with stack trace pointing to `useFormField` called outside its context. The crash happened on page navigation, not at startup, so it wasn't caught during initial testing.

**What I changed:** Replaced the two bare `<FormLabel>` elements with `<p className="text-sm font-medium leading-none">` — a plain HTML paragraph styled to match the shadcn label appearance. The fix preserved the visual design while removing the invalid hook dependency.

---

### Case 3: Duplicate detection missed the Marina Bites case

**What happened:** The AI's `isDuplicate` function normalised both descriptions by stripping non-alphanumeric characters and compared for equality:
- `"Dinner at Marina Bites"` → `"dinneratmarinabites"`
- `"dinner - marina bites"` → `"dinnermarinabites"`

These are not equal (one has "at", the other has a dash), so the duplicate was silently missed.

**How I caught it:** Manually traced the actual CSV through the import logic. Row 6 (`dinner - marina bites`) was being imported as a valid expense when it should have been flagged as a duplicate of Row 5 (`Dinner at Marina Bites` — same date, same payer Dev, same amount ₹3200, with the same group in `split_with`).

**What I changed:** Extended `isDuplicate` to also check: *same date + same payer (case-insensitive) + same amount (within ±1)* as a secondary duplicate signal, even when descriptions differ. This correctly catches both exact description duplicates and "fuzzy" duplicates where only phrasing differs. The issue report now distinguishes between exact and fuzzy matches.

---

### Case 4: Settlement detection missed Row 38 (Sam deposit)

**What happened:** The AI's settlement detection checked `description` for keywords like "paid back", "settlement", "repay" — but also required the `split_type` field to be **empty**. Row 38 (`Sam deposit share`) had `split_type = "equal"`, so it passed the settlement check and was imported as a normal expense. However, the notes clearly say "Sam moving in! paid Aisha his deposit" — this is a direct two-person payment, not a shared group expense.

**How I caught it:** Reading the CSV notes column carefully. The description "deposit share" plus the notes confirmed this was a financial handover between Sam and Aisha, not a split among all flatmates.

**What I changed:** (1) Removed the `!rawSplitType || rawSplitType === ""` requirement — settlement detection now fires regardless of the stated split_type. (2) Extended the detection regex to also search the `notes` field for patterns like "paid.*deposit" and "moving in.*paid.*deposit", which correctly identifies Row 38.

---

### Case 5: Stale DB lib declarations caused cascade typecheck failures

**What happened:** After the AI wrote the new DB schema files, running `pnpm --filter @workspace/api-server run typecheck` produced `TS2305: Module "@workspace/db" has no exported member 'expensesTable'` (and similar errors for all seven new tables). The AI initially suggested checking the import paths, which was a dead-end — the exports were correct in the source.

**How I caught it:** The actual cause was that `lib/db` is a composite TypeScript library that emits declaration files (`.d.ts`). The new tables had been added to `lib/db/src/schema/index.ts` but `tsc --build` had not been re-run, so the stale `.d.ts` files in `lib/db/dist/` still reflected the old schema with no tables exported.

**What I changed:** Ran `pnpm run typecheck:libs` to rebuild the composite lib declarations. After that, all leaf package typechecks passed. Added this to `replit.md` under Gotchas: *"After editing `lib/db/src/schema/`, run `pnpm run typecheck:libs` before leaf package checks."*
