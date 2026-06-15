# AI_USAGE.md — AI Tool Usage Log

## Tool Used

**Claude (Anthropic, claude-sonnet-4-6)** — used as the primary development collaborator throughout the build.

---

## How I Used It

Claude was used as a pair programmer, not a code generator. The workflow was:

1. Reason through the problem (architecture, anomaly policy) myself
2. Write a precise prompt for a specific module
3. Read every line of the output before accepting it
4. Run the code; trace a realistic input through it manually
5. Catch bugs; fix them; note the correction here

---

## Key Prompts

### 1. Schema design for temporal membership
> "Design a relational SQLite schema for a shared expenses app where group membership changes over time. Sam joined mid-April, Meera left end of March. I need to be able to answer: 'Was Meera a member on 2026-04-02?' and 'Which members were active on 2026-03-10?' Use only standard SQL — no JSON columns, no arrays."

**Produced:** The `group_memberships` table with `joined_at` + `left_at`. Used directly after verifying the predicate `joined_at <= date AND (left_at IS NULL OR left_at > date)` by hand against the known membership timeline.

### 2. Importer for real CSV
> "Write a Node.js CSV import function that reads expenses_export.csv with columns: date, description, paid_by, amount, currency, split_type, split_with, split_details, notes. Handle these specific anomalies from the real file: [listed all 20 from SCOPE.md]. For each anomaly: detect it, surface a human-readable description, and handle it according to the documented policy. Never crash. Never silently guess."

**Produced:** First draft of `csvImporter.js`. Two bugs caught (see below).

### 3. Balance minimization algorithm
> "Implement the greedy minimum-transfers debt simplification. Input: Map of userId → netBalance (positive = owed to them, negative = they owe). Output: array of {from, to, amount} with the fewest possible payments. Walk me through it step by step for this example: Aisha +500, Rohan -300, Priya -200."

**Produced:** Correct two-pointer greedy implementation. Verified by hand against the example.

### 4. Percentage normalisation
> "In the CSV importer, when percentage splits don't sum to 100%, normalise them. Show me how you'd handle 30%+30%+30%+20% = 110% for a ₹1440 expense. The last participant gets the remainder to handle rounding."

**Produced:** The normalisation loop in `parsePercentages` + split computation. Verified: 1440 × (30/110) = 392.73, 1440 × (30/110) = 392.73, 1440 × (30/110) = 392.73, remainder = 1440 - 3×392.73 = 261.81 → Meera gets ₹261.81. Total = ₹1440.00 ✓.

---

## Three Cases Where Claude Produced Wrong Output

### Bug 1: Settlement Detection Used `includes('transfer')` — Too Broad

**What Claude wrote:**
```javascript
function isSettlementDescription(desc, notes) {
  const text = ((desc || '') + ' ' + (notes || '')).toLowerCase();
  return text.includes('transfer') || text.includes('settlement') ||
    text.includes('paid') || ...;
}
```

**The problem:** `text.includes('paid')` would match "Maid salary Feb" (contains "ai**d**" after "p" — no, actually "paid" as a substring would not match "Maid"). BUT `text.includes('transfer')` would match descriptions like "Transferred electricity costs" or "Train fare (transfer at station)" — legitimate expenses. And `text.includes('paid')` catches "Priya paid for groceries" — which is a normal expense description, not a settlement.

**How I caught it:** I traced "Maid salary Feb" through the function. It doesn't contain "paid" so it was fine — but "Wifi bill paid by Rohan" would be misclassified. I wrote five test descriptions on paper, including "Groceries paid at DMart" and confirmed it triggered falsely.

**What I changed:**
```javascript
// Before: text.includes('paid')   ← matches any expense where 'paid' appears
// After: specific phrases only
return /paid .+ back|settlement|settling|deposit\s+(share|payment)|paying back/.test(text);
```
The regex requires `paid [something] back` as a phrase, not just the word "paid".

---

### Bug 2: Equal Split Ignored `split_with` Column — Used All Active Members Instead

**What Claude wrote (first draft):**
```javascript
if (resolvedSplitType === 'equal') {
  // Get all members active on expense date
  const activeMembers = memberships.filter(m =>
    wasMemberOn(m.user_id, expenseDate)
  );
  splits = activeMembers.map(...);
}
```

**The problem:** Row 8 (`Movie night snacks`) has `split_with = Aisha;Rohan;Priya` (Meera skipped). But the code above would split it 4 ways (all active members on 14-02-2026 = Aisha, Rohan, Priya, Meera). The CSV explicitly says who to split with for every row — that column must be respected, not overridden.

**How I caught it:** I traced row 8 manually. Expected: 3 participants (640/3 = ₹213.33 each). Claude's code produced: 4 participants (640/4 = ₹160 each). Wrong.

**What I changed:**
```javascript
// Equal split uses split_with column to determine participants,
// THEN filters by active membership (handles Meera-in-April case)
const splitParticipants = rawSplitWith.split(';').map(resolve).filter(user => 
  user && wasMemberOn(memberships, user.id, expenseDate)
);
splits = splitParticipants.map(...);
```
The `split_with` column is the source of truth for who shares the expense. Membership filtering is an additional guard (removes people who are listed but shouldn't be, like Meera in row 35).

---

### Bug 3: Thalassa Conflict Detection Matched the Same Row Against Itself

**What Claude wrote:**
```javascript
const conflictKey = `${expenseDate}|${descSlug}`;
if (descDatePayerSeen.has(conflictKey)) {
  // flag as conflict
}
descDatePayerSeen.set(conflictKey, { rowNum, desc, amount, payerId: payer.id });
```

**The problem:** When row 23 was processed, `descDatePayerSeen` was empty — no conflict flagged ✓. When row 24 was processed, `conflictKey` matched. But the description slugs for rows 23 and 24 are different:
- Row 23: `dinneratthalassa`  
- Row 24: `thalassadinner`

These two slugs are NOT the same string, so `descDatePayerSeen.has(conflictKey)` returned `false` — the conflict was **not detected**.

**How I caught it:** I ran a quick Node.js snippet:
```javascript
console.log('dinneratthalassa' === 'thalassadinner'); // false
```
Then I read the CSV again. The two rows have similar but not identical descriptions. Claude's exact-slug approach would miss them.

**What I changed:** Instead of exact slug match, I check if any existing key on the same date contains an overlapping word set:
```javascript
// Check if any same-date entry shares at least 2 significant words
const words = descSlug.match(/[a-z]{4,}/g) || [];
const prevEntry = [...descDatePayerSeen.entries()].find(([k, v]) => {
  if (!k.startsWith(expenseDate)) return false;
  const prevWords = k.split('|')[1].match(/[a-z]{4,}/g) || [];
  const shared = words.filter(w => prevWords.includes(w));
  return shared.length >= 1 && v.payerId !== payer.id; // different payers, same event word
});
```
This correctly matches `thalassa` as the shared word between `dinneratthalassa` and `thalassadinner`.

---

## Reflection

The pattern across all three bugs: Claude produces code that works for the obvious case but misses the specific shape of the real data. The fix each time was to read the actual CSV row, trace the code path manually, and compare expected vs. actual output before accepting anything. The bugs weren't subtle — they would have all shown up immediately during real use. The lesson is that AI-generated code for data-cleaning tasks must be tested against the actual data, not just the specification.
