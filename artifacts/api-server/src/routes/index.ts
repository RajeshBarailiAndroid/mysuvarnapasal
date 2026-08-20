import { Router, type IRouter } from "express";
import apiRouter from "./api.js";
import { createAuthRouter } from "./auth.js";
import healthRouter from "./health.js";
import { createAttachUser } from "../middlewares/auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(createAttachUser('/cron/capture-gold-rate'));
router.use('/auth', createAuthRouter());
router.use('/', apiRouter);

export default router;
