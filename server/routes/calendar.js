
import express from 'express';

import readRouter from './calendar/read.js';
import googleRouter from './calendar/google.js';
import appleRouter from './calendar/apple.js';
import subscriptionsRouter from './calendar/subscriptions.js';
import feedRouter from './calendar/feed.js';
import crudRouter from './calendar/crud.js';
import caldavRouter from './calendar/caldav.js';
import outlookRouter from './calendar/outlook.js';
import syncTargetsRouter from './calendar/sync-targets.js';
import { googleTarget } from './calendar/helpers.js';

const router = express.Router();

router.use(readRouter);
router.use(googleRouter);
router.use(appleRouter);
router.use(subscriptionsRouter);
router.use(feedRouter);
router.use(syncTargetsRouter);
router.use(crudRouter);
router.use(caldavRouter);


router.use(outlookRouter);

export default router;


export const __test = { googleTarget };
