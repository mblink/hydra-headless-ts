import express from 'express';
import { syncLogger } from '../logging-effect.js';

const router = express.Router();

router.head('/', (req, res) => {
  syncLogger.info('HEAD / request received', { headers: req.headers });
  res.set('X-Hydra-Headless-Special', 'Head-Only-Value');
  res.status(200).end();
});

router.get('/', (req, res) => {
  syncLogger.info('GET / request received', { headers: req.headers });
  res.set('X-Hydra-Headless-Special', 'Head-Only-Value');
  res.status(200).end();
});

router.post('/', (req, res) => {
  syncLogger.info('POST / request received', { headers: req.headers });
  res.set('X-Hydra-Headless-Special', 'Head-Only-Value');
  res.status(200).end();
});

export default router;
