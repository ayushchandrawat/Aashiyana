
import express from 'express';

import vitalsRouter from './health/vitals.js';
import medicationsRouter from './health/medications.js';
import labsRouter from './health/labs.js';
import activitiesRouter from './health/activities.js';
import exportRouter from './health/export.js';
import cycleRouter from './health/cycle.js';
import cycleFeedRouter from './health/cycle-feed.js';
import caregiversRouter from './health/caregivers.js';
import visibilityDefaultsRouter from './health/visibility-defaults.js';

const router = express.Router();



// unkritisch - defensiv bleibt sie wie zuvor erhalten.
router.use(vitalsRouter);
router.use(medicationsRouter);
router.use(labsRouter);
router.use(activitiesRouter);
router.use(exportRouter);
router.use(cycleRouter);
router.use(cycleFeedRouter);
router.use(caregiversRouter);
router.use(visibilityDefaultsRouter);

export default router;
