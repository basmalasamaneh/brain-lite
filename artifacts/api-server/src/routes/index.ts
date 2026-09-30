import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import memoriesRouter from "./memories";
import brainRouter from "./brain";
import voiceRouter from "./voice";
import semanticRouter from "./semantic";
import connectionsRouter from "./connections";
import spacesRouter from "./spaces";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(memoriesRouter);
router.use(brainRouter);
router.use(voiceRouter);
router.use(semanticRouter);
router.use(connectionsRouter);
router.use(spacesRouter);
router.use(notificationsRouter);

export default router;
