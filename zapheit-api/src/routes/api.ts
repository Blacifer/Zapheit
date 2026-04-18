import express from 'express';
import agentsRouter from './agents';
import conversationsRouter from './conversations';
import chatRouter from './chat';
import incidentsRouter from './incidents';
import dashboardRouter from './dashboard';
import batchesRouter from './batches';
import alertChannelsRouter from './alert-channels';

const router = express.Router();

// Domain sub-routers — each file owns its slice of the API surface
router.use(agentsRouter);
router.use(conversationsRouter);
router.use(chatRouter);
router.use(incidentsRouter);
router.use(dashboardRouter);
router.use(batchesRouter);
router.use(alertChannelsRouter);

export default router;
