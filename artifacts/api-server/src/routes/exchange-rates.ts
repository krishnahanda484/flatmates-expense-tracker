import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, exchangeRatesTable } from "@workspace/db";
import { SetExchangeRateBody } from "@workspace/api-zod";

const router: IRouter = Router();

function parseNum(val: unknown): number {
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "number") return val;
  return 0;
}

router.get("/exchange-rates", async (req, res): Promise<void> => {
  try {
    const { userId: clerkId } = getAuth(req);

    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rates = await db
      .select()
      .from(exchangeRatesTable)
      .orderBy(exchangeRatesTable.effectiveDate);

    res.json(
      rates.map((r) => ({
        ...r,
        rate: parseNum(r.rate),
      }))
    );
  } catch (err: any) {
    console.error("GET EXCHANGE RATES ERROR");
    console.error(err);
    console.error(err?.cause);

    res.status(500).json({
      error: err?.message,
      cause: err?.cause?.message,
    });
  }
});

router.post("/exchange-rates", async (req, res): Promise<void> => {
  try {
    const { userId: clerkId } = getAuth(req);

    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = SetExchangeRateBody.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.message,
      });
      return;
    }

    const {
      fromCurrency,
      toCurrency,
      rate,
      effectiveDate,
    } = parsed.data;

    const existing = await db
      .select()
      .from(exchangeRatesTable)
      .where(
        and(
          eq(exchangeRatesTable.fromCurrency, fromCurrency),
          eq(exchangeRatesTable.toCurrency, toCurrency),
          eq(exchangeRatesTable.effectiveDate, effectiveDate)
        )
      )
      .limit(1);

    let result;

    if (existing[0]) {
      const [updated] = await db
        .update(exchangeRatesTable)
        .set({
          rate: rate.toString(),
        })
        .where(eq(exchangeRatesTable.id, existing[0].id))
        .returning();

      result = updated;
    } else {
      const [created] = await db
        .insert(exchangeRatesTable)
        .values({
          fromCurrency,
          toCurrency,
          rate: rate.toString(),
          effectiveDate,
        })
        .returning();

      result = created;
    }

    res.json({
      ...result,
      rate: parseNum(result!.rate),
    });
  } catch (err: any) {
    console.error("POST EXCHANGE RATE ERROR");
    console.error(err);
    console.error(err?.cause);

    res.status(500).json({
      error: err?.message,
      cause: err?.cause?.message,
    });
  }
});

export default router;