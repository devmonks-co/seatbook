import { Router } from 'express';
import { z } from 'zod';
import prisma from '../db';
import { requireAuth, requireRole, optionalAuth, AuthRequest } from '../middleware/auth';
import { getEventWithSeats, listEvents } from '../services/eventService';
import { asyncHandler, HttpError } from '../lib/errors';
import { idParam } from '../lib/validation';
import { seatLabel } from '../utils/helpers';

const router = Router();

export const MAX_ROWS = 26; // row labels are A-Z
export const MAX_COLS = 30;

const createEventSchema = z.object({
  title: z.string().trim().min(1, 'is required').max(200),
  description: z.string().trim().max(5000).default(''),
  venue: z.string().trim().min(1, 'is required').max(200),
  startsAt: z
    .string()
    .datetime({ offset: true, message: 'must be an ISO date-time' })
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() > Date.now(), 'must be in the future'),
  rows: z.number().int().min(1).max(MAX_ROWS),
  cols: z.number().int().min(1).max(MAX_COLS),
  priceCents: z.number().int().min(0).max(100_000_00).default(0),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listEvents());
  })
);

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = idParam.safeParse(req.params.id);
    const event = id.success ? await getEventWithSeats(id.data, req.user?.id) : null;
    if (!event) throw new HttpError(404, 'Event not found', 'NOT_FOUND');
    res.json(event);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ORGANIZER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const input = createEventSchema.parse(req.body ?? {});

    const seats = [];
    for (let r = 0; r < input.rows; r++) {
      for (let c = 0; c < input.cols; c++) {
        seats.push({ row: r, col: c, label: seatLabel(r, c) });
      }
    }

    const event = await prisma.event.create({
      data: { ...input, organizerId: req.user!.id, seats: { create: seats } },
    });

    res.status(201).json(event);
  })
);

export default router;
