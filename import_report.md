# IMPORT_REPORT.md

## Import Report

**Application:** Flatmates — Shared Expenses Tracker
**Import Source:** expenses_export.csv
**Import Date:** 15 June 2026
**Imported By:** Krishna Handa

---

## Summary

| Metric               | Value      |
| -------------------- | ---------- |
| Total Rows Processed | 39         |
| Expenses Imported    | 39         |
| Settlements Created  | 0          |
| Rows Rejected        | 0          |
| Warnings Generated   | Multiple   |
| Import Status        | Successful |

---

## Exchange Rate Applied

All USD-denominated expenses were converted to INR using the configured exchange rate stored in the application.

| Currency Pair | Rate  |
| ------------- | ----- |
| USD → INR     | 84.00 |

---

## Anomalies Detected

The importer performs validation and normalization before persisting records.

### Warning: Percentage Normalization

Some percentage-based splits did not sum exactly to 100%.

**Action Taken:** Percentages were normalized while preserving their relative proportions.

---

### Warning: Excess Decimal Precision

Some monetary values contained more than two decimal places.

**Action Taken:** Values were rounded to two decimal places before storage.

---

### Warning: Duplicate-Like Records

Potential duplicate expenses were detected based on similar amounts, descriptions, and participants.

**Action Taken:** Records were imported and flagged for review rather than automatically removed.

---

### Warning: Currency Conversion Required

Several expenses were recorded in USD.

**Action Taken:** Values were converted to INR using the configured exchange rate and stored in normalized form.

---

### Warning: Membership Validation

Expense participants were validated against active group memberships.

**Action Taken:** Membership dates were checked before balance calculations were performed.

---

## Data Imported

The following entities were successfully created or updated:

* Users
* Groups
* Group Memberships
* Expenses
* Expense Splits
* Exchange Rate Records

---

## Post-Import Verification

The following checks were performed after import:

* Expense totals calculated successfully
* Member balances generated successfully
* Settlement recommendations generated successfully
* Group statistics generated successfully
* Exchange rate conversion verified successfully

---

## Result

The dataset was imported successfully and is available within the application.

The imported data can be viewed through:

* Dashboard
* Expense History
* Balance Overview
* Settlement Suggestions
* Exchange Rate Management

---

## Notes

This report is submitted as part of the Spreetail Software Developer Assignment.

Repository Deliverables:

1. README.md
2. SCOPE.md
3. DECISIONS.md
4. AI_USAGE.md
5. IMPORT_REPORT.md

GitHub Repository: https://github.com/krishnahanda484/flatmates-expense-tracker

Live Application: https://flatmates-expense-tracker-1.onrender.com
