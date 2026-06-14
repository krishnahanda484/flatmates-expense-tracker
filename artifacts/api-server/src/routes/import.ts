import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, expensesTable, expenseSplitsTable, membershipsTable, exchangeRatesTable, importSessionsTable } from "@workspace/db";
import { PreviewImportBody, ConfirmImportBody } from "@workspace/api-zod";
import crypto from "crypto";

const router: IRouter = Router();

interface ParsedRow {
  rowNumber: number;
  date: string;
  description: string;
  paidBy: string;
  amount: number | null;
  currency: string;
  splitType: string;
  splitWith: string[];
  splitDetails: string;
  notes: string;
  raw: string;
}

interface ImportIssue {
  rowNumber: number;
  issueType: string;
  description: string;
  actionTaken: string;
  severity: "error" | "warning" | "info";
  rawRow?: string;
}

// In-memory session store (good enough for short-lived preview sessions)
const previewSessions = new Map<string, { rows: ParsedRow[]; issues: ImportIssue[]; groupId: number; createdAt: number }>();

function parseDate(raw: string): { date: string | null; issue: string | null } {
  if (!raw || !raw.trim()) return { date: null, issue: "Empty date" };
  const s = raw.trim();

  // DD-MM-YYYY
  const isoMatch = s.match(/^(\d{1,2})-(\d{2})-(\d{4})$/);
  if (isoMatch) {
    const [, d, m, y] = isoMatch;
    const dt = new Date(`${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`);
    if (!isNaN(dt.getTime())) {
      const dayNum = parseInt(d!);
      const monNum = parseInt(m!);
      // Both day and month ≤ 12 → could be interpreted as MM-DD-YYYY too
      const ambiguous = dayNum <= 12 && monNum <= 12 && dayNum !== monNum;
      return {
        date: `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`,
        issue: ambiguous
          ? `Ambiguous date "${s}" — interpreted as DD-MM-YYYY (${d}/${m}/${y}); could also be MM-DD-YYYY (${m}/${d}/${y})`
          : null,
      };
    }
  }

  // Mar-14 style (ambiguous: could be Mar 14 of current year)
  const monDayMatch = s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (monDayMatch) {
    const [, mon, day] = monDayMatch;
    const monthMap: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const m = monthMap[mon!.toLowerCase()];
    if (m) {
      return {
        date: `2026-${m}-${day!.padStart(2, "0")}`,
        issue: `Ambiguous date format "${s}" — assumed 2026`,
      };
    }
  }

  // DD/MM/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    return {
      date: `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`,
      issue: `Ambiguous date format "${s}" — assumed DD/MM/YYYY`,
    };
  }

  // DD-MM-YY (ambiguous: could be MM/DD)
  const ambiguousMatch = s.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (ambiguousMatch) {
    const [, p1, p2, y] = ambiguousMatch;
    return {
      date: `20${y}-${p1}-${p2}`,
      issue: `Ambiguous date format "${s}" — assumed DD-MM-YY as 20${y}-${p1}-${p2}`,
    };
  }

  // Try native Date parsing as last resort
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return { date: dt.toISOString().slice(0, 10), issue: `Unusual date format "${s}" — parsed as ${dt.toISOString().slice(0, 10)}` };
  }

  return { date: null, issue: `Unrecognizable date "${s}"` };
}

function parseAmount(raw: string): { amount: number | null; issue: string | null } {
  if (!raw || !raw.trim()) return { amount: null, issue: "Missing amount" };
  const cleaned = raw.replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  if (isNaN(n)) return { amount: null, issue: `Non-numeric amount "${raw}"` };
  if (n < 0) return { amount: n, issue: `Negative amount ${n} — treated as refund` };
  if (n === 0) return { amount: 0, issue: `Zero amount — likely a placeholder or cancelled entry` };
  // Suspicious precision: more than 2 decimal places
  const decPart = cleaned.split(".")[1];
  if (decPart && decPart.length > 2) {
    return { amount: Math.round(n * 100) / 100, issue: `Excessive precision "${raw}" — rounded to ${Math.round(n * 100) / 100}` };
  }
  return { amount: n, issue: null };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === "," && !inQuotes) { fields.push(current); current = ""; continue; }
    current += c;
  }
  fields.push(current);
  return fields;
}

function parseSplitDetails(raw: string): Record<string, number> {
  if (!raw || !raw.trim()) return {};
  const result: Record<string, number> = {};
  // "Rohan 700; Priya 400; Meera 400" or "Aisha 30%; Rohan 30%;"
  const parts = raw.split(";");
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(.+?)\s+([\d.]+)%?$/);
    if (m) {
      result[m[1]!.trim()] = parseFloat(m[2]!);
    }
  }
  return result;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isDuplicate(a: ParsedRow, b: ParsedRow): { dup: boolean; fuzzy: boolean } {
  const descA = a.description.replace(/[^a-z0-9]/g, "").toLowerCase();
  const descB = b.description.replace(/[^a-z0-9]/g, "").toLowerCase();
  const sameDate = a.date === b.date;
  const sameAmount = Math.abs((a.amount ?? 0) - (b.amount ?? 0)) < 1;
  const samePayer = a.paidBy.toLowerCase().trim() === b.paidBy.toLowerCase().trim();
  // Exact description match
  if (sameDate && descA === descB && sameAmount) return { dup: true, fuzzy: false };
  // Same date + same payer + same amount, even if descriptions differ (e.g. "Dinner at Marina Bites" vs "dinner - marina bites")
  if (sameDate && samePayer && sameAmount && (a.amount ?? 0) > 0) return { dup: true, fuzzy: true };
  return { dup: false, fuzzy: false };
}

function isConflict(a: ParsedRow, b: ParsedRow): boolean {
  if (a.date !== b.date) return false;
  if (a.paidBy.toLowerCase().trim() === b.paidBy.toLowerCase().trim()) return false; // same payer = dup not conflict
  // Find a common significant keyword (≥ 6 chars) in both descriptions
  const wordsA = a.description.toLowerCase().split(/\W+/).filter(w => w.length >= 6);
  const wordsB = b.description.toLowerCase().split(/\W+/).filter(w => w.length >= 6);
  const hasCommonWord = wordsA.some(w => wordsB.includes(w));
  if (!hasCommonWord) return false;
  // Amounts within 20% of each other (same event, slightly different logged amounts)
  const amtA = Math.abs(a.amount ?? 0);
  const amtB = Math.abs(b.amount ?? 0);
  const maxAmt = Math.max(amtA, amtB);
  return maxAmt > 0 && Math.abs(amtA - amtB) / maxAmt < 0.20;
}

async function getUsdToInr(): Promise<number> {
  const rates = await db.select().from(exchangeRatesTable)
    .where(eq(exchangeRatesTable.fromCurrency, "USD"))
    .orderBy(desc(exchangeRatesTable.effectiveDate))
    .limit(1);
  return rates[0] ? parseFloat(rates[0].rate as string) : 84;
}

async function resolveUser(name: string): Promise<number | null> {
  if (!name.trim()) return null;
  const normalized = name.trim().toLowerCase();

  // Look for exact match first
  const allUsers = await db.select().from(usersTable);
  const exact = allUsers.find(u => u.name.toLowerCase() === normalized);
  if (exact) return exact.id;

  // Partial match (e.g. "Priya S" → "Priya")
  const partial = allUsers.find(u => normalized.startsWith(u.name.toLowerCase()) || u.name.toLowerCase().startsWith(normalized));
  if (partial) return partial.id;

  // Create ghost user
  const [newUser] = await db.insert(usersTable).values({
    clerkId: `import_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: name.trim(),
    email: "",
  }).returning();
  return newUser!.id;
}

function parseCSV(csvContent: string): { headers: string[]; dataRows: string[][] } {
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], dataRows: [] };
  const headers = parseCsvLine(lines[0]!).map(h => h.trim().toLowerCase());
  const dataRows = lines.slice(1).map(l => parseCsvLine(l));
  return { headers, dataRows };
}

router.post("/import/preview", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = PreviewImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { csvContent, groupId } = parsed.data;
  const issues: ImportIssue[] = [];
  const validRows: ParsedRow[] = [];

  const { headers, dataRows } = parseCSV(csvContent);

  // Expected headers
  const COL = {
    date: headers.indexOf("date"),
    description: headers.indexOf("description"),
    paidBy: headers.indexOf("paid_by"),
    amount: headers.indexOf("amount"),
    currency: headers.indexOf("currency"),
    splitType: headers.indexOf("split_type"),
    splitWith: headers.indexOf("split_with"),
    splitDetails: headers.indexOf("split_details"),
    notes: headers.indexOf("notes"),
  };

  const seenRows: ParsedRow[] = [];
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-indexed, row 1 is header
    const cols = dataRows[i]!;
    const rawRow = cols.join(",");

    const get = (idx: number) => (idx >= 0 && idx < cols.length ? (cols[idx] ?? "").trim() : "");

    const rawDate = get(COL.date);
    const description = get(COL.description);
    const rawPaidBy = get(COL.paidBy);
    const rawAmount = get(COL.amount);
    const rawCurrency = get(COL.currency);
    const rawSplitType = get(COL.splitType);
    const rawSplitWith = get(COL.splitWith);
    const rawSplitDetails = get(COL.splitDetails);
    const notes = get(COL.notes);

    const rowIssues: ImportIssue[] = [];

    // Parse date
    const { date, issue: dateIssue } = parseDate(rawDate);
    if (dateIssue) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: date ? "ambiguous_date" : "invalid_date",
        description: dateIssue,
        actionTaken: date ? "Interpreted and imported" : "Row skipped",
        severity: date ? "warning" : "error",
        rawRow,
      });
    }
    if (!date) {
      skipped++;
      issues.push(...rowIssues);
      continue;
    }

    // Parse amount
    const { amount, issue: amountIssue } = parseAmount(rawAmount);
    if (amountIssue) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: amount === null ? "invalid_amount" : amount < 0 ? "negative_amount" : "zero_amount",
        description: amountIssue,
        actionTaken: amount === null ? "Row skipped" : amount < 0 ? "Treated as refund (negative expense)" : "Row flagged, imported with zero amount",
        severity: amount === null ? "error" : "warning",
        rawRow,
      });
    }
    if (amount === null) {
      skipped++;
      issues.push(...rowIssues);
      continue;
    }

    // Check for settlement masquerading as expense
    const lowerDesc = description.toLowerCase();
    const lowerNotes = notes.toLowerCase();
    const isSettlementLike =
      /paid.*back|settlement|settling|repay/i.test(lowerDesc) ||
      /paid.*deposit|moving in.*paid.*deposit/i.test(lowerNotes);
    if (isSettlementLike) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "settlement_as_expense",
        description: `Row "${description}" looks like a settlement/deposit payment, not a shared expense`,
        actionTaken: "Flagged as settlement — imported as settlement record rather than expense split",
        severity: "warning",
        rawRow,
      });
    }

    // Missing paid_by
    if (!rawPaidBy) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "missing_paid_by",
        description: `No paid_by value for row "${description}"`,
        actionTaken: "Row skipped — cannot assign expense without payer",
        severity: "error",
        rawRow,
      });
      skipped++;
      issues.push(...rowIssues);
      continue;
    }

    // "Priya S" name normalization
    const normalizedPaidBy = rawPaidBy.replace(/\s+[A-Z]\.?$/, "").trim();
    if (normalizedPaidBy !== rawPaidBy) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "name_normalization",
        description: `paid_by "${rawPaidBy}" looks like a surname initial — normalized to "${normalizedPaidBy}"`,
        actionTaken: "Normalized name used",
        severity: "info",
        rawRow,
      });
    }

    // name casing difference (e.g. "priya" vs "Priya")
    const allUsers = await db.select().from(usersTable);
    const caseMatch = allUsers.find(u => u.name.toLowerCase() === rawPaidBy.toLowerCase() && u.name !== rawPaidBy);
    if (caseMatch) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "name_casing",
        description: `paid_by "${rawPaidBy}" has different casing from known user "${caseMatch.name}"`,
        actionTaken: `Matched to "${caseMatch.name}"`,
        severity: "info",
        rawRow,
      });
    }

    // Currency
    let currency = rawCurrency.toUpperCase();
    if (!currency) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "missing_currency",
        description: `No currency set for row "${description}"`,
        actionTaken: "Defaulted to INR",
        severity: "warning",
        rawRow,
      });
      currency = "INR";
    }
    if (!["INR", "USD"].includes(currency)) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "unknown_currency",
        description: `Unknown currency "${currency}"`,
        actionTaken: "Defaulted to INR",
        severity: "warning",
        rawRow,
      });
      currency = "INR";
    }

    // Split type
    let splitType = rawSplitType.toLowerCase().trim();
    const validSplitTypes = ["equal", "percentage", "unequal", "exact", "share", ""];
    if (splitType && !validSplitTypes.includes(splitType)) {
      rowIssues.push({
        rowNumber: rowNum,
        issueType: "unknown_split_type",
        description: `Unknown split_type "${splitType}"`,
        actionTaken: "Defaulted to equal",
        severity: "warning",
        rawRow,
      });
      splitType = "equal";
    }
    // normalize "unequal" → "exact"
    if (splitType === "unequal") splitType = "exact";
    if (!splitType) splitType = isSettlementLike ? "settlement" : "equal";

    // Detect equal split_type with named share details (e.g. "Aisha 1; Rohan 1; ...")
    if (splitType === "equal" && rawSplitDetails) {
      const detailKeys = Object.keys(parseSplitDetails(rawSplitDetails));
      if (detailKeys.length > 0) {
        rowIssues.push({
          rowNumber: rowNum,
          issueType: "conflicting_split_info",
          description: `split_type is "equal" but split_details contains named values "${rawSplitDetails}" — details ignored`,
          actionTaken: "Equal split applied; split_details discarded",
          severity: "info",
          rawRow,
        });
      }
    }

    // Percentage validation: check if percentages sum to ~100
    if (splitType === "percentage" && rawSplitDetails) {
      const details = parseSplitDetails(rawSplitDetails);
      const total = Object.values(details).reduce((s, v) => s + v, 0);
      if (Math.abs(total - 100) > 0.5) {
        rowIssues.push({
          rowNumber: rowNum,
          issueType: "percentage_mismatch",
          description: `Percentages sum to ${total.toFixed(1)}%, not 100%`,
          actionTaken: "Percentages normalized to 100%",
          severity: "warning",
          rawRow,
        });
      }
    }

    // Split-with includes non-member (e.g. Dev, Kabir)
    const splitWithNames = rawSplitWith.split(";").map(s => s.trim()).filter(Boolean);
    for (const name of splitWithNames) {
      const normalName = name.replace(/\s+[A-Z]\.?$/, "").trim();
      const inGroup = await db.select().from(membershipsTable)
        .leftJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
        .where(eq(membershipsTable.groupId, groupId))
        .then(rows => rows.some(r => (r.users?.name ?? "").toLowerCase() === normalName.toLowerCase()));

      if (!inGroup) {
        rowIssues.push({
          rowNumber: rowNum,
          issueType: "non_member",
          description: `"${name}" is not a current group member`,
          actionTaken: "User will be created and added to group if not found",
          severity: "warning",
          rawRow,
        });
      }
    }

    // Build parsed row
    const parsedRow: ParsedRow = {
      rowNumber: rowNum,
      date,
      description,
      paidBy: normalizedPaidBy || rawPaidBy,
      amount,
      currency,
      splitType,
      splitWith: splitWithNames,
      splitDetails: rawSplitDetails,
      notes,
      raw: rawRow,
    };

    // Check for duplicates within file
    let dupFound = false;
    for (const seen of seenRows) {
      const { dup, fuzzy } = isDuplicate(seen, parsedRow);
      if (dup) {
        rowIssues.push({
          rowNumber: rowNum,
          issueType: "duplicate_row",
          description: fuzzy
            ? `Same date, payer, and amount as row ${seen.rowNumber} ("${seen.description}") — descriptions differ but likely the same event`
            : `Exact duplicate of row ${seen.rowNumber}: "${seen.description}" on ${seen.date}`,
          actionTaken: "Row skipped — first occurrence kept",
          severity: "warning",
          rawRow,
        });
        skipped++;
        dupFound = true;
        break;
      }
    }
    if (dupFound) {
      issues.push(...rowIssues);
      continue;
    }

    // Check for conflicting entries (same date, different payer, similar description, close amounts)
    for (const seen of seenRows) {
      if (isConflict(seen, parsedRow)) {
        rowIssues.push({
          rowNumber: rowNum,
          issueType: "conflicting_entry",
          description: `Possible conflict with row ${seen.rowNumber} ("${seen.description}", paid by ${seen.paidBy}, ₹${seen.amount}) — same date, shared keyword in description, similar amount but different payer`,
          actionTaken: "Both rows imported with conflict warning — review and manually delete the incorrect entry",
          severity: "warning",
          rawRow,
        });
      }
    }

    seenRows.push(parsedRow);
    validRows.push(parsedRow);
    issues.push(...rowIssues);
  }

  // Token for confirming
  const sessionToken = crypto.randomBytes(16).toString("hex");
  previewSessions.set(sessionToken, { rows: validRows, issues, groupId, createdAt: Date.now() });

  // Clean up old sessions (>1 hour)
  for (const [k, v] of previewSessions) {
    if (Date.now() - v.createdAt > 3600000) previewSessions.delete(k);
  }

  const previewRows = seenRows.map(r => {
    const rowIssueList = issues.filter(i => i.rowNumber === r.rowNumber);
    const hasError = rowIssueList.some(i => i.severity === "error");
    const hasWarning = rowIssueList.some(i => i.severity === "warning");
    return {
      rowNumber: r.rowNumber,
      description: r.description,
      amount: r.amount,
      currency: r.currency,
      paidBy: r.paidBy,
      splitType: r.splitType,
      date: r.date,
      status: hasError ? "skipped" : hasWarning ? "needs_review" : "ok",
      issues: rowIssueList,
    };
  });

  res.json({
    sessionToken,
    totalRows: dataRows.length,
    validRows: validRows.length,
    skippedRows: skipped,
    issueCount: issues.length,
    issues,
    rows: previewRows,
  });
});

router.post("/import/confirm", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ConfirmImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { sessionToken, groupId } = parsed.data;
  const session = previewSessions.get(sessionToken);
  if (!session) { res.status(400).json({ error: "Invalid or expired session token" }); return; }

  previewSessions.delete(sessionToken);
  const { rows, issues } = session;

  const usdRate = await getUsdToInr();
  let importedCount = 0;
  let skippedCount = 0;

  // Create a DB session record first
  const [dbSession] = await db.insert(importSessionsTable).values({
    filename: "expenses_export.csv",
    groupId,
    importedCount: 0,
    skippedCount: 0,
    issueCount: issues.length,
    issues: issues as any,
  }).returning();

  for (const row of rows) {
    try {
      const paidByUserId = await resolveUser(row.paidBy);
      if (!paidByUserId) { skippedCount++; continue; }

      const amountInr = row.currency === "USD" ? (row.amount ?? 0) * usdRate : (row.amount ?? 0);
      const isSettlement = row.splitType === "settlement";

      const [expense] = await db.insert(expensesTable).values({
        groupId,
        description: row.description,
        amount: (row.amount ?? 0).toString(),
        currency: row.currency,
        amountInr: amountInr.toString(),
        splitType: isSettlement ? "equal" : row.splitType,
        date: row.date,
        paidByUserId,
        notes: row.notes || null,
        isSettlement,
        importedFromSession: dbSession!.id,
      }).returning();

      // Resolve split-with users and create splits
      const splitWithUsers: number[] = [];
      for (const name of row.splitWith) {
        const uid = await resolveUser(name);
        if (uid) splitWithUsers.push(uid);
      }

      // Ensure paidBy is in the group
      const existingMembership = await db.select().from(membershipsTable)
        .where(eq(membershipsTable.groupId, groupId))
        .then(rows => rows.find(m => m.userId === paidByUserId));
      if (!existingMembership) {
        await db.insert(membershipsTable).values({ groupId, userId: paidByUserId, joinedAt: row.date });
      }

      // Compute splits
      if (splitWithUsers.length > 0) {
        const splitDetails = parseSplitDetails(row.splitDetails);
        const splitDetailNames = Object.keys(splitDetails);

        if (row.splitType === "equal") {
          const each = Math.round((amountInr / splitWithUsers.length) * 100) / 100;
          for (const uid of splitWithUsers) {
            await db.insert(expenseSplitsTable).values({ expenseId: expense!.id, userId: uid, amountOwed: each.toString() });
          }
        } else if (row.splitType === "percentage") {
          let total = Object.values(splitDetails).reduce((s, v) => s + v, 0);
          if (Math.abs(total - 100) > 0.5) {
            // Normalize
            const factor = 100 / total;
            for (const k of Object.keys(splitDetails)) splitDetails[k]! *= factor;
            total = 100;
          }
          for (const uid of splitWithUsers) {
            const userName = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1).then(r => r[0]?.name ?? "");
            const matchedName = splitDetailNames.find(n => n.toLowerCase() === userName.toLowerCase()) ?? splitDetailNames[0];
            const pct = matchedName ? (splitDetails[matchedName] ?? 0) : (100 / splitWithUsers.length);
            const amt = Math.round((amountInr * pct / 100) * 100) / 100;
            await db.insert(expenseSplitsTable).values({ expenseId: expense!.id, userId: uid, amountOwed: amt.toString(), percentage: pct.toString() });
          }
        } else if (row.splitType === "exact" || row.splitType === "unequal") {
          for (const uid of splitWithUsers) {
            const userName = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1).then(r => r[0]?.name ?? "");
            const matchedName = splitDetailNames.find(n => n.toLowerCase() === userName.toLowerCase());
            const amt = matchedName ? (splitDetails[matchedName] ?? 0) : 0;
            await db.insert(expenseSplitsTable).values({ expenseId: expense!.id, userId: uid, amountOwed: amt.toString() });
          }
        } else if (row.splitType === "share") {
          const totalShares = Object.values(splitDetails).reduce((s, v) => s + v, 0) || splitWithUsers.length;
          for (const uid of splitWithUsers) {
            const userName = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1).then(r => r[0]?.name ?? "");
            const matchedName = splitDetailNames.find(n => n.toLowerCase() === userName.toLowerCase());
            const shares = matchedName ? (splitDetails[matchedName] ?? 1) : 1;
            const amt = Math.round((amountInr * shares / totalShares) * 100) / 100;
            await db.insert(expenseSplitsTable).values({ expenseId: expense!.id, userId: uid, amountOwed: amt.toString(), shareCount: shares.toString() });
          }
        } else {
          // Equal fallback
          const each = Math.round((amountInr / splitWithUsers.length) * 100) / 100;
          for (const uid of splitWithUsers) {
            await db.insert(expenseSplitsTable).values({ expenseId: expense!.id, userId: uid, amountOwed: each.toString() });
          }
        }
      }

      importedCount++;
    } catch (err) {
      skippedCount++;
    }
  }

  // Update session record
  await db.update(importSessionsTable).set({ importedCount, skippedCount }).where(eq(importSessionsTable.id, dbSession!.id));

  res.json({ sessionId: dbSession!.id, importedCount, skippedCount, issueCount: issues.length });
});

router.get("/import/sessions", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessions = await db.select().from(importSessionsTable).orderBy(desc(importSessionsTable.importedAt));
  res.json(sessions);
});

router.get("/import/sessions/:sessionId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw!, 10);
  const [session] = await db.select().from(importSessionsTable).where(eq(importSessionsTable.id, sessionId)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  res.json(session);
});

export default router;
