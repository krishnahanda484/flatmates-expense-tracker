# Flatmates — Functional Scope

## In Scope

### 1. Authentication
- Sign-in / sign-up via Clerk (Google OAuth + email/password)
- Session persistence via cookies (no manual token handling required)
- Server-side authentication via `@clerk/express` middleware (`requireAuth`)

### 2. User Profiles
- Auto-created on first sign-in (JIT provisioning from Clerk identity)
- Fields: `clerk_id`, `email`, `name`, `avatar_url`
- Users cannot delete their own accounts (data integrity)

### 3. Groups
- Create a named group with an optional description
- Time-bounded membership: each record has `joined_at` and optional `left_at`
- Active member = `left_at IS NULL OR left_at > NOW()`
- Remove a member by setting `left_at = NOW()`
- Soft-delete groups (mark inactive, not physical delete)
- Only group members can view or modify group data

### 4. Expenses

#### 4.1 Split Types
| Type | Rules |
|------|-------|
| `equal` | Total divided equally across all selected members |
| `percentage` | Each member's share specified as a percentage; must sum to 100 |
| `exact` | Each member's exact amount specified; must sum to expense total |
| `share` | Each member given a share count; owed = (shares / total_shares) × total |
| `settlement` | Direct payment from one member to another; no split rows |

#### 4.2 Currency Handling
- Expenses can be entered in **INR** or **USD**
- USD amounts are converted at the current saved exchange rate (default: 84 INR/USD)
- All internal balances are stored and computed in INR
- Original currency and amount are stored for display

#### 4.3 Expense Fields
- `paid_by_user_id` — who paid
- `amount` + `currency` — original amount
- `amount_inr` — converted amount (INR)
- `description`, `date`, `category` (optional)
- `split_type`
- Array of `expense_splits` records

### 5. Settlements
- Record a direct payment from one member to another
- Reduces the net balance between the two members
- "Suggested settlements" uses a debt-minimization algorithm (greedy creditor/debtor matching)

### 6. Balances
- Net balance per member = sum(amounts paid) − sum(amounts owed after splits) − amounts settled
- Computed in real-time from `expenses`, `expense_splits`, and `settlements`
- Per-pair breakdown available for settlement suggestions

### 7. CSV Import

#### 7.1 File Format
The importer accepts the `expenses_export.csv` format with these columns (case-insensitive headers):
```
date, description, paid_by, amount, currency, split_type, split_with, split_details, notes
```

- `split_with`: semicolon-separated member names, e.g. `Aisha;Rohan;Priya;Meera`
- `split_details`: space-separated name+value pairs, semicolons between members, e.g. `Rohan 700; Priya 400; Meera 400` or `Aisha 30%; Rohan 30%`
- Dates accepted: `DD-MM-YYYY`, `Mar-14`, `DD/MM/YYYY`

#### 7.2 Import Flow
1. Upload CSV → `POST /api/groups/:id/import/preview`
2. Server parses and validates; returns preview with valid row list + full anomaly report
3. User reviews anomalies; `POST /api/groups/:id/import/confirm` with session token
4. Server commits valid rows to DB in a single transaction

---

## Anomaly Log — expenses_export.csv

The following table documents every data problem found in `expenses_export.csv`, the detection method, and the action taken.

| Row | Description | Anomaly Type | Details | Severity | Action Taken |
|-----|-------------|-------------|---------|----------|--------------|
| 6 | dinner - marina bites | **Duplicate entry** | Same date (08-02-2026), same payer (Dev), same amount (3200 INR) as Row 5 ("Dinner at Marina Bites") — different casing/punctuation in description | WARNING | Row 6 skipped; Row 5 (with notes) kept |
| 7 | Electricity Feb | **Comma-formatted amount** | Amount field is `"1,200"` — comma as thousands separator inside quotes | INFO | Commas stripped; parsed as 1200 |
| 9 | Movie night snacks | **Lowercase payer name** | `paid_by` = `priya` — does not match capitalised name `Priya` in the database | INFO | Case-insensitive match applied; treated as `Priya` |
| 10 | Cylinder refill | **Excessive decimal precision** | Amount `899.995` has 3 decimal places; INR cannot be sub-paisa | INFO | Rounded to 2 decimal places → ₹900.00 |
| 11 | Groceries DMart (Feb) | **Surname initial in payer name** | `paid_by` = `Priya S` — trailing initial suggests a different person from `Priya` | WARNING | Partial-name match applied; mapped to `Priya`. Policy: partial match is informational; if a distinct `Priya S` exists they should be separate users |
| 12 | Aisha birthday cake | **Non-standard split type** | `split_type` = `unequal` — not one of the five supported types | WARNING | Normalised to `exact`; split_details (`Rohan 700; Priya 400; Meera 400`) used as exact amounts |
| 13 | House cleaning supplies | **Missing payer** | `paid_by` is empty — cannot create an expense without knowing who paid | ERROR | Row skipped |
| 14 | Rohan paid Aisha back | **Settlement recorded as expense** | Description contains "paid back"; `split_type` is empty. Note: "this is a settlement not an expense??" | WARNING | Imported as a `settlement` record between Rohan and Aisha, not as an expense split |
| 15 | Pizza Friday | **Percentage splits don't sum to 100%** | Aisha 30% + Rohan 30% + Priya 30% + Meera 20% = **110%** | WARNING | Percentages normalised proportionally to 100% (each divided by 1.10) |
| 23 | Parasailing | **Non-member in split_with** | `split_with` includes `Dev's friend Kabir` — not a group member | WARNING | Kabir added as a guest user and included in the split; balance treated as a group liability |
| 24–25 | Dinner at Thalassa / Thalassa dinner | **Conflicting entries for the same event** | Row 24: paid by Aisha, ₹2400. Row 25: paid by Rohan, ₹2450 on the same date. Both contain the word "thalassa". Note on Row 25: "Aisha also logged this I think hers is wrong" | WARNING | Both rows imported with a conflict warning; user must manually resolve which is correct and delete the other |
| 26 | Parasailing refund | **Negative amount** | Amount is `-30` USD — CSV note says "one slot got cancelled" | WARNING | Treated as a refund/negative expense; `amount_inr` stored as a negative value; reduces the balance |
| 27 | Airport cab | **Non-standard date format** | Date is `Mar-14` — no year specified | WARNING | Interpreted as March 14, 2026 (current year); imported with warning |
| 27 | Airport cab | **Trailing whitespace in payer name** | `paid_by` = `rohan ` (trailing space) | INFO | Trimmed and case-matched to `Rohan` |
| 28 | Groceries DMart (Mar) | **Missing currency** | `currency` field is empty | WARNING | Defaulted to INR; imported with warning |
| 31 | Dinner order Swiggy | **Zero amount** | Amount is `0` — note says "counted twice earlier - fixing later" | WARNING | Imported with zero amount; effectively a no-op on balances but kept for record |
| 34 | Deep cleaning service | **Ambiguous date format** | Date is `04-05-2026` — could be April 5 (DD-MM-YYYY) or May 4 (MM-DD-YYYY). Note confirms ambiguity. | WARNING | Interpreted as DD-MM-YYYY → May 4, 2026; flagged for user review |
| 36 | Groceries BigBasket (Apr) | **Former member in split_with** | `split_with` includes `Meera`, who moved out at end of March. Expense date is 02-04-2026. | WARNING | If Meera has a `left_at` date set in the group, she is excluded from the split and the remaining members share equally |
| 38 | Sam deposit share | **Settlement recorded as expense** | Notes say "Sam moving in! paid Aisha his deposit". This is a one-to-one payment, not a shared expense. | WARNING | Imported as a `settlement` record from Sam to Aisha |
| 42 | Furniture for common room | **Conflicting split metadata** | `split_type` is `equal` but `split_details` contains `Aisha 1; Rohan 1; Priya 1; Sam 1` — share-style data. Note confirms confusion. | INFO | Equal split applied (split_details ignored); four-way equal split recorded |

**Total anomalies detected: 19** (across 17 CSV rows; rows 24-25 and 27 each have 2 anomalies)

**Rows skipped (ERROR):** 1 (Row 13 — missing payer)
**Rows imported with warnings:** 12
**Rows with info-level normalisation:** 5

---

## Database Schema

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| clerk_id | text unique | Clerk identity; `import_*` prefix for CSV-imported ghost users |
| email | text | |
| name | text | |
| avatar_url | text nullable | |
| created_at | timestamp | |

### `groups`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| name | text | |
| description | text nullable | |
| created_by_user_id | int FK→users | |
| is_active | boolean | soft delete |
| created_at | timestamp | |

### `memberships`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| group_id | int FK→groups | |
| user_id | int FK→users | |
| joined_at | date | Membership start date |
| left_at | date nullable | NULL = currently active |
| created_at | timestamp | |

**Unique constraint:** `(group_id, user_id, joined_at)` — allows re-joining

### `expenses`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| group_id | int FK→groups | |
| description | text | |
| amount | numeric(12,2) | Original amount in stated currency |
| currency | text | `INR` or `USD` |
| amount_inr | numeric(12,2) | Converted amount; basis for all balance calculations |
| split_type | text | `equal`, `percentage`, `exact`, `share`, `settlement` |
| date | date | |
| paid_by_user_id | int FK→users | |
| notes | text nullable | |
| is_settlement | boolean | True for settlement-type rows |
| imported_from_session | int FK→import_sessions nullable | |
| created_at | timestamp | |

### `expense_splits`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| expense_id | int FK→expenses | |
| user_id | int FK→users | Who owes this portion |
| amount_owed | numeric(12,2) | Amount this person owes (INR) |
| percentage | numeric(6,2) nullable | For percentage splits |
| share_count | numeric(8,2) nullable | For share splits |
| created_at | timestamp | |

### `settlements`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| group_id | int FK→groups | |
| from_user_id | int FK→users | Who paid |
| to_user_id | int FK→users | Who received |
| amount | numeric(12,2) | Amount paid (INR) |
| date | date | |
| notes | text nullable | |
| created_at | timestamp | |

### `exchange_rates`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| from_currency | text | |
| to_currency | text | |
| rate | numeric(12,4) | |
| effective_date | date | Most recent rate wins |
| created_at | timestamp | |

### `import_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| filename | text | |
| group_id | int FK→groups | |
| imported_count | int | |
| skipped_count | int | |
| issue_count | int | |
| issues | jsonb | Full anomaly report |
| imported_at | timestamp | |

---

## Out of Scope

- **Push notifications** — no real-time updates
- **Recurring expenses** — all expenses are one-off
- **Multi-currency balances** — all balances maintained in INR only
- **Expense attachments / receipts** — no file storage
- **Email notifications** — not implemented
- **Group invitation flow** — members added directly by existing members
- **Role-based access** — all group members have equal permissions
- **Mobile app** — web only
- **Multi-group settlements** — settlements are per-group only

## Known Limitations

- Group membership `left_at` for Meera and Sam must be set manually in the app before importing to get accurate time-bounded exclusions
- CSV import assumes names in the file match names in the group (case-insensitive); ambiguous partials (like "Priya S") are matched heuristically
- Negative amounts (refunds) are stored as negative `amount_inr` — the balance calculation treats them correctly but the UI shows them as negative expenses
