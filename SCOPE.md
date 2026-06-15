# SCOPE.md — Anomaly Log & Database Schema

---

## Database Schema

### `users`
| Column        | Type      | Notes                        |
|---------------|-----------|------------------------------|
| id            | TEXT PK   | UUID v4                      |
| name          | TEXT      | Display name (canonical)     |
| email         | TEXT UQ   | Login credential             |
| password_hash | TEXT      | bcrypt-10                    |
| created_at    | TEXT      | ISO 8601 datetime            |

### `groups`
| Column      | Type    | Notes                     |
|-------------|---------|---------------------------|
| id          | TEXT PK | UUID v4                   |
| name        | TEXT    |                           |
| description | TEXT    | nullable                  |
| created_by  | TEXT FK | → users.id                |
| created_at  | TEXT    |                           |

### `group_memberships`  ← temporal; key design decision
| Column    | Type    | Notes                                              |
|-----------|---------|----------------------------------------------------|
| id        | TEXT PK |                                                    |
| group_id  | TEXT FK | → groups.id                                        |
| user_id   | TEXT FK | → users.id                                         |
| joined_at | TEXT    | inclusive lower bound                              |
| left_at   | TEXT    | nullable; NULL = still active; exclusive upper bound |

**Why this table:** Sam joined mid-April. Meera left end of March. Every equal split filters with `joined_at ≤ expense_date AND (left_at IS NULL OR left_at > expense_date)`.

### `expenses`
| Column        | Type    | Notes                                                   |
|---------------|---------|---------------------------------------------------------|
| id            | TEXT PK |                                                         |
| group_id      | TEXT FK |                                                         |
| description   | TEXT    |                                                         |
| amount        | REAL    | In original currency (USD or INR)                       |
| currency      | TEXT    | 'INR' or 'USD'                                          |
| amount_inr    | REAL    | Always INR: amount × exchange_rate                      |
| exchange_rate | REAL    | 1.0 for INR; 83.5 for USD (documented assumption)       |
| paid_by       | TEXT FK | → users.id                                              |
| split_type    | TEXT    | equal / exact / percentage / shares                     |
| expense_date  | TEXT    | YYYY-MM-DD (normalized on import)                       |
| is_settlement | INT     | 1 = reclassified settlement; excluded from balances     |
| is_deleted    | INT     | soft-delete flag                                        |
| import_id     | TEXT    | `import-{sessionId}-r{rowNum}` — traceability           |
| notes         | TEXT    | Original notes + import flags appended                  |
| created_by    | TEXT FK | → users.id                                              |
| created_at    | TEXT    |                                                         |

### `expense_splits`
| Column     | Type    | Notes                                      |
|------------|---------|--------------------------------------------|
| id         | TEXT PK |                                            |
| expense_id | TEXT FK | → expenses.id                              |
| user_id    | TEXT FK | → users.id                                 |
| amount     | REAL    | INR amount this person owes                |
| percentage | REAL    | nullable; set for percentage split_type    |
| shares     | REAL    | nullable; set for shares split_type        |

### `settlements`
| Column     | Type    | Notes                            |
|------------|---------|----------------------------------|
| id         | TEXT PK |                                  |
| group_id   | TEXT FK |                                  |
| payer_id   | TEXT FK | Who sent money                   |
| payee_id   | TEXT FK | Who received money               |
| amount     | REAL    | In original currency             |
| currency   | TEXT    |                                  |
| amount_inr | REAL    |                                  |
| settled_at | TEXT    |                                  |
| notes      | TEXT    | nullable                         |
| created_by | TEXT FK |                                  |

### `import_sessions`
| Column        | Type  | Notes                            |
|---------------|-------|----------------------------------|
| id            | TEXT PK |                                |
| filename      | TEXT  |                                  |
| imported_by   | TEXT FK | → users.id                    |
| imported_at   | TEXT  |                                  |
| total_rows    | INT   |                                  |
| imported_rows | INT   |                                  |
| skipped_rows  | INT   |                                  |
| status        | TEXT  | pending / processing / completed |

### `import_anomalies`
| Column              | Type  | Notes                                   |
|---------------------|-------|-----------------------------------------|
| id                  | TEXT PK |                                       |
| session_id          | TEXT FK | → import_sessions.id                 |
| row_number          | INT   | 1-indexed CSV row                       |
| raw_data            | TEXT  | JSON of raw CSV record                  |
| anomaly_type        | TEXT  | See enum below                          |
| anomaly_description | TEXT  | Human-readable problem statement        |
| action_taken        | TEXT  | What the importer decided to do         |
| severity            | TEXT  | error / warning / info                  |

### `import_pending_approvals`  ← Meera's requirement
| Column          | Type  | Notes                               |
|-----------------|-------|-------------------------------------|
| id              | TEXT PK |                                   |
| session_id      | TEXT FK |                                   |
| row_number      | INT   |                                     |
| raw_data        | TEXT  | JSON                                |
| proposed_action | TEXT  | e.g. SKIP_NEAR_DUPLICATE            |
| reason          | TEXT  | Plain-English explanation           |
| status          | TEXT  | pending / approved / rejected       |
| resolved_by     | TEXT FK | → users.id; nullable             |
| resolved_at     | TEXT  | nullable                            |

---

## Anomaly Log — Every Problem Found in the Real `expenses_export.csv`

The CSV has 42 data rows. Column names are:
`date, description, paid_by, amount, currency, split_type, split_with, split_details, notes`

---

### Problem 1 — NEAR_DUPLICATE (Rows 4 & 5)
| Field | Value |
|-------|-------|
| **Row 4** | `08-02-2026, Dinner at Marina Bites, Dev, 3200, INR, equal` |
| **Row 5** | `08-02-2026, dinner - marina bites, Dev, 3200, INR, equal` |

**What's wrong:** Same event (Dev's dinner at Marina Bites), same date, same payer, same amount. Description differs only in casing and punctuation.

**Detection:** Signature = `date | payer.lower | amount`. Row 5 matches Row 4's broad signature.

**Policy:** Row 5 skipped. Row 4 kept. Both added to the pending approvals queue so Meera can confirm the deletion was correct.

**Why not keep both:** Would double the ₹3200 expense and inflate every participant's balance by ₹800.

---

### Problem 2 — COMMA_IN_AMOUNT (Row 6)
| Field | Value |
|-------|-------|
| **Row 6** | `10-02-2026, Electricity Feb, Aisha, "1,200", INR` |

**What's wrong:** Amount field contains `"1,200"` — a thousands-separator comma wrapped in quotes. Most parsers will either fail or treat it as `1` (before comma) and `200` (after).

**Detection:** `rawAmount.includes(',')` after CSV parsing gives us `1,200` as a string.

**Policy:** Strip commas, parse as `1200.00`. Flagged as warning. Imported.

---

### Problem 3 — PAYER_NAME_CASING (Row 8)
| Field | Value |
|-------|-------|
| **Row 8** | `14-02-2026, Movie night snacks, priya, 640, INR` |

**What's wrong:** `paid_by = "priya"` (lowercase). Canonical name is `"Priya"`.

**Detection:** `resolveUserName()` does case-insensitive match.

**Policy:** Matched to user Priya. Logged as INFO. Imported.

---

### Problem 4 — EXCESS_PRECISION (Row 9)
| Field | Value |
|-------|-------|
| **Row 9** | `15-02-2026, Cylinder refill, Rohan, 899.995, INR` |

**What's wrong:** Amount `899.995` has 3 decimal places (sub-paisa). Splitting this 4 ways produces infinite fractions. Storing and displaying sub-paisa amounts is meaningless.

**Detection:** `decimalPart.length > 2` after `parseFloat`.

**Policy:** Rounded to `₹900.00` using standard half-up rounding. Flagged as INFO. Imported.

---

### Problem 5 — PAYER_NAME_TYPO (Row 10)
| Field | Value |
|-------|-------|
| **Row 10** | `18-02-2026, Groceries DMart, Priya S, 1875, INR` |

**What's wrong:** `paid_by = "Priya S"` — extra initial. No user named "Priya S" exists.

**Detection:** `resolveUserName()` tries starts-with match: `"priya s"` starts with `"priya"` → resolves to Priya.

**Policy:** Matched to Priya via prefix resolution. Logged as INFO with the normalization. Imported.

---

### Problem 6 — SPLIT_TYPE_UNEQUAL (Row 11)
| Field | Value |
|-------|-------|
| **Row 11** | `20-02-2026, Aisha birthday cake, Rohan, 1500, INR, unequal, Rohan;Priya;Meera, Rohan 700; Priya 400; Meera 400` |

**What's wrong:** `split_type = "unequal"` is not a recognised type. The `split_details` column clearly shows exact amounts per person.

**Detection:** `rawSplitType === 'unequal'` branch.

**Policy:** Remapped to `"exact"`. Amounts parsed from `split_details`. Total check: 700+400+400 = 1500 ✓. Logged as INFO. Imported.

---

### Problem 7 — MISSING_PAYER (Row 12)
| Field | Value |
|-------|-------|
| **Row 12** | `22-02-2026, House cleaning supplies, (blank), 780, INR` |
| **Note** | `can't remember who paid` |

**What's wrong:** `paid_by` is empty.

**Policy:** Row skipped. Cannot assign credit for payment without knowing who paid. Logged as ERROR.

**Why not guess:** Assigning the wrong payer would create a false debt. The group should agree on who paid and add it manually.

---

### Problem 8 — SETTLEMENT_AS_EXPENSE (Row 13)
| Field | Value |
|-------|-------|
| **Row 13** | `25-02-2026, Rohan paid Aisha back, Rohan, 5000, INR` |
| **Note** | `this is a settlement not an expense??` |

**What's wrong:** This is a cash repayment from Rohan to Aisha. If treated as a shared expense, it would create new debts rather than clear existing ones.

**Detection:** Description matches regex `/paid .+ back|settlement|settling|deposit/`.

**Policy:** Imported with `is_settlement = 1`. Recorded in settlements table. Excluded from expense balance calculations. Logged as WARNING.

---

### Problem 9 — PERCENTAGE_SUM_WRONG (Row 14)
| Field | Value |
|-------|-------|
| **Row 14** | `28-02-2026, Pizza Friday, Aisha, 1440, INR, percentage` |
| **split_details** | `Aisha 30%; Rohan 30%; Priya 30%; Meera 20%` |
| **Note** | `percentages might be off` |

**What's wrong:** 30+30+30+20 = **110%**, not 100%. The expense total would be over-allocated by 10%.

**Detection:** `pcts.reduce((a,b) => a+b.pct, 0) = 110`.

**Policy:** Normalise: divide each percentage by 110 so they sum to 100%. Effective split: Aisha 27.27%, Rohan 27.27%, Priya 27.27%, Meera 18.18%. Flagged as WARNING. Imported.

**Why normalise instead of reject:** The note says "might be off" — the relative proportions are clearly intended; the user just over-counted. Normalisation preserves intent.

---

### Problem 10 — SPLIT_TYPE_ALIAS (Row 21)
| Field | Value |
|-------|-------|
| **Row 21** | `10-03-2026, Scooter rentals, Priya, 3600, INR, share` |

**What's wrong:** `split_type = "share"` (singular) — should be `"shares"`.

**Detection:** `rawSplitType === 'share'` branch.

**Policy:** Remapped to `"shares"`. Split computed from `split_details`: `Aisha 1; Rohan 2; Priya 1; Dev 2`. Logged as INFO. Imported.

---

### Problem 11 — UNKNOWN_PARTICIPANT (Row 22)
| Field | Value |
|-------|-------|
| **Row 22** | `11-03-2026, Parasailing, Dev, 150, USD` |
| **split_with** | `Aisha;Rohan;Priya;Dev;Dev's friend Kabir` |
| **Note** | `Kabir joined for the day` |

**What's wrong:** `Dev's friend Kabir` is not a registered user.

**Detection:** `resolveUserName("Dev's friend Kabir", allUsers)` returns null.

**Policy:** Kabir excluded from split. Cost of $150 USD redistributed equally among 4 known participants (Aisha, Rohan, Priya, Dev). Logged as WARNING.

**Why not create a ghost user:** Ghost users pollute the user table and make balances unrecoverable. The group can manually adjust if needed.

---

### Problem 12 — THALASSA_CONFLICT (Rows 23 & 24)
| Field | Row 23 | Row 24 |
|-------|--------|--------|
| Date | 11-03-2026 | 11-03-2026 |
| Description | `Dinner at Thalassa` | `Thalassa dinner` |
| Paid by | Aisha | Rohan |
| Amount | ₹2400 | ₹2450 |
| **Note (row 24)** | — | `Aisha also logged this I think hers is wrong` |

**What's wrong:** Same dinner logged by two different people with different amounts and slight description differences. Row 24's note explicitly says it might be a duplicate.

**Detection:** Fuzzy description slug match (`thalassadinner` ≈ `dinneratthalassa`) on same date.

**Policy:** Both rows imported (neither is definitively wrong — one could be a correction). Both added to pending approvals queue. Meera (or any member) must choose which row to delete. Flagged as WARNING on both rows.

**Why both:** Deleting either without user confirmation risks losing the correct amount.

---

### Problem 13 — NEGATIVE_AMOUNT (Row 25)
| Field | Value |
|-------|-------|
| **Row 25** | `12-03-2026, Parasailing refund, Dev, -30, USD` |
| **Note** | `one slot got cancelled` |

**What's wrong:** Amount is -$30.

**Detection:** `parsedAmount < 0`.

**Policy:** Treated as a positive refund of $30 USD (≈ ₹2505). Split equally among the same participants. Note "REFUND" appended. Flagged as WARNING. Imported.

**Rationale:** A refund is economically opposite to an expense — the payer (Dev) receives money back on behalf of the group. Storing as positive with the REFUND label achieves the correct balance effect (reduces what others owe Dev).

---

### Problem 14 — INVALID_DATE_FORMAT (Row 26)
| Field | Value |
|-------|-------|
| **Row 26** | `Mar-14, Airport cab, rohan , 1100, INR` |

**What's wrong:** Date `Mar-14` has no year. `rohan` has a trailing space.

**Detection:** Regex `/^([A-Za-z]{3})-(\d{1,2})$/` — month-name-day without year.

**Policy:** Assumed year 2026 (consistent with all surrounding rows). Date set to `2026-03-14`. Trailing space in payer name stripped and resolved to Rohan. Flagged as WARNING. Imported.

---

### Problem 15 — MISSING_CURRENCY (Row 27)
| Field | Value |
|-------|-------|
| **Row 27** | `15-03-2026, Groceries DMart, Priya, 2105, (blank)` |
| **Note** | `forgot to set currency` |

**What's wrong:** Currency column is empty.

**Detection:** `rawCurrency === ''`.

**Policy:** Defaulted to INR. Reasoning: every non-trip expense in this CSV is INR; row date (15-03) is after the Goa trip ended (12-03); amount ₹2105 is plausible for groceries. Flagged as WARNING. Imported.

---

### Problem 16 — ZERO_AMOUNT (Row 30)
| Field | Value |
|-------|-------|
| **Row 30** | `22-03-2026, Dinner order Swiggy, Priya, 0, INR` |
| **Note** | `counted twice earlier - fixing later` |

**What's wrong:** Amount is zero. The note confirms it's a placeholder, not a real expense.

**Policy:** Row skipped. Zero-amount expenses have no effect on balances. Flagged as WARNING.

---

### Problem 17 — AMBIGUOUS_DATE (Row 33)
| Field | Value |
|-------|-------|
| **Row 33** | `04-05-2026, Deep cleaning service, Rohan, 2500, INR` |
| **Note** | `is this April 5 or May 4? format is a mess` |

**What's wrong:** `04-05-2026` under DD-MM-YYYY = May 4. Under MM-DD-YYYY = April 5. The note itself flags the ambiguity.

**Detection:** Note contains "format is a mess" + date matches `04-05-2026` pattern.

**Policy:** Interpreted as DD-MM-YYYY = `2026-05-04` (consistent with all other rows in the CSV). Added to pending approvals for user confirmation. Flagged as WARNING. Imported.

---

### Problem 18 — INACTIVE_MEMBER_IN_SPLIT (Row 35)
| Field | Value |
|-------|-------|
| **Row 35** | `02-04-2026, Groceries BigBasket, Priya, 2640, INR` |
| **split_with** | `Aisha;Rohan;Priya;Meera` |
| **Note** | `oops Meera still in the group list` |

**What's wrong:** Meera left at the end of March. Including her in a 2 April expense would incorrectly assign her a debt for groceries she had no access to.

**Detection:** `wasMemberOn(memberships, meera.id, '2026-04-02')` returns false.

**Policy:** Meera removed from split. Expense redistributed equally among Aisha, Rohan, Priya. The note confirms this was a data-entry mistake. Flagged as WARNING.

---

### Problem 19 — SETTLEMENT_AS_EXPENSE #2 (Row 37)
| Field | Value |
|-------|-------|
| **Row 37** | `08-04-2026, Sam deposit share, Sam, 15000, INR` |
| **split_with** | `Aisha` |
| **Note** | `Sam moving in! paid Aisha his deposit` |

**What's wrong:** This is Sam paying Aisha a deposit — a one-time bilateral payment, not a group expense.

**Detection:** Description matches regex `/deposit\s+(share|payment)/`.

**Policy:** Imported as `is_settlement = 1`. Recorded in settlements table (Sam → Aisha, ₹15000). Excluded from group expense balances. Flagged as WARNING.

---

### Problem 20 — SPLIT_TYPE_CONFLICT (Row 41)
| Field | Value |
|-------|-------|
| **Row 41** | `18-04-2026, Furniture for common room, Aisha, 12000, INR, equal` |
| **split_details** | `Aisha 1; Rohan 1; Priya 1; Sam 1` |
| **Note** | `split_type says equal but someone added shares anyway` |

**What's wrong:** `split_type = "equal"` but `split_details` has share-count syntax (each person 1 share). Since all shares are equal, the result is identical to a plain equal split.

**Detection:** `rawSplitType === 'equal' && rawSplitDets contains ';'`.

**Policy:** Kept as `equal` split — the numeric result is the same. Flagged as INFO. Imported.

---

## Summary Table

| # | Row | Anomaly Type | Severity | Action |
|---|-----|-------------|----------|--------|
| 1 | 5 | NEAR_DUPLICATE | warning | Skipped row 5; kept row 4; pending approval |
| 2 | 6 | COMMA_IN_AMOUNT | warning | Stripped comma; parsed as 1200 |
| 3 | 8 | PAYER_NAME_CASING | info | Normalised "priya" → "Priya" |
| 4 | 9 | EXCESS_PRECISION | info | Rounded 899.995 → 900.00 |
| 5 | 10 | PAYER_NAME_TYPO | info | Resolved "Priya S" → "Priya" |
| 6 | 11 | SPLIT_TYPE_UNEQUAL | info | Remapped "unequal" → "exact" |
| 7 | 12 | MISSING_PAYER | error | Row skipped |
| 8 | 13 | SETTLEMENT_AS_EXPENSE | warning | is_settlement=1; excluded from balances |
| 9 | 14 | PERCENTAGE_SUM_WRONG | warning | Normalised 110% → 100% |
| 10 | 21 | SPLIT_TYPE_ALIAS | info | Remapped "share" → "shares" |
| 11 | 22 | UNKNOWN_PARTICIPANT | warning | Kabir excluded; redistributed |
| 12 | 23+24 | THALASSA_CONFLICT | warning | Both kept; pending approval |
| 13 | 25 | NEGATIVE_AMOUNT | warning | Treated as refund; imported |
| 14 | 26 | INVALID_DATE_FORMAT | warning | Best-guessed year 2026 |
| 15 | 27 | MISSING_CURRENCY | warning | Defaulted to INR |
| 16 | 30 | ZERO_AMOUNT | warning | Row skipped |
| 17 | 33 | AMBIGUOUS_DATE | warning | Imported as 2026-05-04; pending approval |
| 18 | 35 | INACTIVE_MEMBER_IN_SPLIT | warning | Meera removed; redistributed |
| 19 | 37 | SETTLEMENT_AS_EXPENSE | warning | is_settlement=1 |
| 20 | 41 | SPLIT_TYPE_CONFLICT | info | Kept as equal (identical result) |
