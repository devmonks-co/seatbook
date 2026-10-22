import { Router } from 'express';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../lib/errors';
import { idParam, seatIdBody } from '../lib/validation';
import { confirmHold, holdSeat, releaseHold } from '../services/bookingService';

const router = Router();

router.use(requireAuth, requireRole('ATTENDEE'));

router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const { seatId } = seatIdBody.parse(req.body ?? {});
    const hold = await holdSeat(req.user!.id, seatId);
    res.status(201).json({ ...hold, serverTime: new Date() });
  })
);

router.post(
  '/:id/confirm',
  asyncHandler(async (req: AuthRequest, res) => {
    const id = idParam.parse(req.params.id);
    res.json(await confirmHold(req.user!.id, id));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const id = idParam.parse(req.params.id);
    await releaseHold(req.user!.id, id);
    res.status(204).end();
  })
);

export default router;
