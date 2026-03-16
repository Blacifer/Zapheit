import express from 'express';
import agentsRouter from './agents';
import conversationsRouter from './conversations';
import incidentsRouter from './incidents';
import dashboardRouter from './dashboard';
import batchesRouter from './batches';

const router = express.Router();

// Domain sub-routers — each file owns its slice of the API surface
router.use(agentsRouter);
router.use(conversationsRouter);
router.use(incidentsRouter);
router.use(dashboardRouter);
router.use(batchesRouter);

export default router;
