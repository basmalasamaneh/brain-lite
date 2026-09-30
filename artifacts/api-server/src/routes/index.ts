import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import memoriesRouter from "./memories";
import brainRouter from "./brain";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(memoriesRouter);
router.use(brainRouter);

export default router;
