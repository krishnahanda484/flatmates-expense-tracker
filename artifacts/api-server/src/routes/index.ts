import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import groupsRouter from "./groups";
import expensesRouter from "./expenses";
import settlementsRouter from "./settlements";
import balancesRouter from "./balances";
import exchangeRatesRouter from "./exchange-rates";
import importRouter from "./import";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(groupsRouter);
router.use(expensesRouter);
router.use(settlementsRouter);
router.use(balancesRouter);
router.use(exchangeRatesRouter);
router.use(importRouter);

export default router;
