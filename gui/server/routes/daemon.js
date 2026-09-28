import {Router} from 'express';

export function createDaemonRouter(context) {
  const router = Router();
  // POST obtains the existing local session-token protection, but performs only a read.
  router.post('/api/daemon/status', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.body || {}).length || Object.keys(req.query).length) {
      return res.status(400).json({code: 'DAEMON_STATUS_INPUT_NOT_ALLOWED', requestId: req.requestId});
    }
    try { res.json(await context.localDaemonStatusService.status()); } catch (error) { next(error); }
  });
  return router;
}
