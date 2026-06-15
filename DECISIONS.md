# DECISIONS.md — Decision Log

Each entry: the decision, alternatives considered, and why I chose what I chose.

---

## 1. Tech Stack: Express + better-sqlite3 + React + Vite

**Options considered:**
| Option | Pro | Con |
|--------|-----|-----|
| Express + SQLite | Zero infra, synchronous API, simple deploy | Not suitable for high concurrency |
| Express + PostgreSQL | Production-grade, concurrent writes | Requires separate DB server, extra cost |
| Next.js + Prisma + SQLite | One codebase | Heavier setup, SSR complexity not needed |
| FastAPI (Python) + SQLite | Good for data scripts | Mixed-language stack, slower iteration |

**Decision:** Express + SQLite (better-sqlite3) + React.

**Why:** This app will have at most 6 concurrent users. SQLite is not a limitation at that scale — it handles hundreds of writes/sec. `better-sqlite3` is synchronous, which means balance calculation code reads like plain logic rather than a chain of `await` calls. Zero infrastructure setup means I can deploy to Railway with a single push and the SQLite file lives on disk. If this ever needed to scale, the migration from SQLite to PostgreSQL is well-documented and the schema is identical.

---

## 2. Temporal Membership via `joined_at` / `left_at` in `group_memberships`

**Problem:** Sam joined mid-April. Meera left end of March. An equal split must only include members who were active on the expense date.

**Options considered:**
| Option | Problem |
|--------|---------|
| Store current membership only, recalculate backward | Impossible — you'd lose who was a member when |
| Store a full snapshot of members per expense | Redundant data, storage-heavy |
| `joined_at` + `left_at` per membership row | Minimal, correct, queryable |

**Decision:** `group_memberships` has `joined_at` (inclusive) and `left_at` (exclusive, nullable).

**Active membership predicate:**
```sql
joined_at <= expense_date AND (left_at IS NULL OR left_at > expense_date)
```

This is called in every import row and every balance computation. It directly satisfies Sam's request ("Why would March electricity affect my balance?") — it won't, because Sam's `joined_at` is 2026-04-15.

---

## 3. Balance Computation: On-the-fly from `expense_splits` + `settlements`

**Options considered:**
| Option | Pro | Con |
|--------|-----|-----|
| Cached balance table (updated on every write) | Fast reads | Can drift from reality if any expense is edited/deleted; concurrency issues |
| On-the-fly from source tables | Always consistent | Slightly slower on large datasets |

**Decision:** On-the-fly computation from `expense_splits` and `settlements`.

**Why:** Correctness over speed. With ~50 expenses and 6 users, the query takes < 1ms. More importantly, Rohan's requirement ("I want to see exactly which expenses make up my balance") requires tracing individual splits — a cached balance number would hide the breakdown. On-the-fly computation makes the breakdown trivially easy: it's the same query, just filtered by two users.

---

## 4. Rounding: Half-up to 2 Decimal Places; Remainder to Payer

**Problem:** ₹1199 split 4 ways = ₹299.75 each (happens to be exact here). But ₹2340 / 4 = ₹585.00. And ₹3200 / 3 = ₹1066.666...

**Options considered:**
| Option | Problem |
|--------|---------|
| Round all shares down, leave remainder in a "pool" | Pool never gets attributed |
| Round all shares to 2 places, assign remainder to first person | Arbitrary |
| Round all shares to 2 places, assign remainder to payer | Payer controls the money; they naturally absorb ₹0.01 rounding |

**Decision:** Round each share independently to 2 decimal places. For the last participant, assign `total - sum_of_earlier_shares` to guarantee sum = total.

**Implementation:** The loop assigns `Math.round(amountINR / count * 100) / 100` to each participant `i < count-1`, and `Math.round((amountINR - accumulated) * 100) / 100` to the last.

The importer applies this consistently for all split types (equal, shares, percentage after normalisation).

---

## 5. Excess Precision (899.995) → Round Immediately on Import

**Problem:** ₹899.995 has sub-paisa precision. Split 4 ways = ₹224.99875. No payment system in India accepts sub-paisa amounts.

**Decision:** Round to 2 decimal places on ingest (before storing). Logged as INFO.

**Why not store raw and round later:** Storing 899.995 and later computing `899.995 / 4` propagates floating-point issues silently across all downstream calculations. Round at the boundary (import time) so all stored values are valid monetary amounts.

---

## 6. Percentage Normalisation (110% → 100%)

**Problem:** Pizza Friday percentages sum to 110%. Options:
1. Reject the row (error)
2. Normalise (divide each % by 110)
3. Keep as-is and allow over-allocation

**Decision:** Normalise. The note says "percentages might be off" — the relative proportions (3:3:3:2) are clearly intentional. Normalising preserves the intended ratio while making the math correct. Logged as WARNING with the computed effective percentages shown to the user.

**Why not reject:** Losing a ₹1440 row because of a data-entry mistake is worse than importing with a corrected percentage. The user can see exactly what we did.

---

## 7. Unknown Participant (Kabir) → Exclude and Redistribute

**Problem:** Row 22 lists `Dev's friend Kabir` in `split_with`. Kabir is not a user.

**Options:**
1. Reject the row
2. Create a ghost/placeholder user
3. Exclude Kabir; redistribute among known participants

**Decision:** Option 3. Kabir's share (1/5 of $150 = $30) is redistributed equally among the 4 known participants.

**Why no ghost users:** Ghost users can never settle their debts. They'd appear in balance summaries with permanent unpaid balances. The group decided to go on a trip together — Kabir's cost is either already settled informally or Dev absorbed it.

---

## 8. Thalassa Conflict → Import Both, Queue for Approval

**Problem:** Rows 23 (Aisha, ₹2400) and 24 (Rohan, ₹2450) are the same dinner. Row 24's note says "Aisha also logged this I think hers is wrong."

**Options:**
1. Keep row 23 (first logged), skip row 24
2. Keep row 24 (higher amount, maybe more accurate), skip row 23
3. Import both; require user to delete one

**Decision:** Option 3. The note is uncertain ("I think"). Rohan says Aisha's might be wrong — but Rohan is speculating. Silently deleting either row could remove the correct one.

**What the user sees:** Both rows appear in the expense list. Both appear in pending approvals with the explanation. The user deletes whichever is wrong and the balance recalculates.

---

## 9. Settlement Detection by Regex on Description + Notes

**Problem:** Two rows are settlements, not expenses:
- Row 13: `Rohan paid Aisha back` 
- Row 37: `Sam deposit share`

**Options:**
1. Require a separate `is_settlement` column in the CSV (can't edit the file)
2. Manual tagging UI (defeats the purpose of import)
3. Regex detection on description + notes text

**Decision:** Regex. Pattern: `/paid .+ back|settlement|settling|deposit\s+(share|payment)|paying back/i`

**Risk acknowledged:** False positives possible (e.g., "I paid for the cake, Aisha said back that it's fine"). Mitigated by: (a) the anomaly is surfaced to the user with the text that matched, (b) they can manually change `is_settlement` after import.

---

## 10. USD Exchange Rate: Fixed ₹83.5 (Not a Live API Call)

**Problem:** Trip expenses are in USD. No exchange rate is in the CSV.

**Options:**
| Option | Problem |
|--------|---------|
| Live FX API call at import time | Rate at import time ≠ rate at expense date; adds external dependency |
| Ask user to enter rate per import | Extra friction; user may not know |
| Fixed documented constant | Transparent, auditable, consistent |

**Decision:** `DEFAULT_USD_INR_RATE = 83.5` (approximate March 2026 USD/INR rate). Documented in `csvImporter.js`, shown in import anomaly log, and noted in every USD row's anomaly description.

**Why 83.5:** Consistent with approximate USD/INR exchange rate for early 2026. The exact rate doesn't matter much for a group of friends — they're splitting costs, not filing taxes.

---

## 11. Soft Delete (`is_deleted = 1`) Instead of Physical DELETE

**Decision:** Expenses are never permanently deleted from the database. `is_deleted = 1` hides them from the UI and balance calculations.

**Why:** Meera's requirement: "I want to approve anything the app deletes or changes." Soft delete means: (a) audit trail is preserved, (b) a deletion can be undone, (c) the import report accurately references row numbers even after rows are "deleted."

---

## 12. Pending Approvals Queue (Meera's Requirement)

Every importer action that skips or flags a row creates a `import_pending_approvals` record. The UI shows these in a review panel where any member can approve or reject.

**What goes in the queue:**
- Near-duplicates that were skipped (Marina Bites)
- Thalassa conflict (both kept, one should be deleted)
- Ambiguous date (Deep cleaning service)

**What does NOT go in the queue:**
- INFO-level normalizations (casing, excess precision) — too noisy for manual review
- Clearly correct decisions (zero amount skip, missing payer skip)

**Why this line:** The queue is for decisions where a human must choose. Mechanical normalizations (lowercase → proper case) don't need human sign-off.
