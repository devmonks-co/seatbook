import { Router } from 'express';
import prisma from '../db';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../lib/errors';
import { idParam, seatIdBody } from '../lib/validation';
import { bookSeat, cancelBooking } from '../services/bookingService';
import { formatPrice } from '../utils/helpers';

const router = Router();

router.use(requireAuth, requireRole('ATTENDEE'));

router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const { seatId } = seatIdBody.parse(req.body ?? {});
    res.status(201).json(await bookSeat(req.user!.id, seatId));
  })
);

router.get(
  '/mine',
  asyncHandler(async (req: AuthRequest, res) => {
    const now = new Date();
    const bookings = await prisma.booking.findMany({
      where: {
        userId: req.user!.id,
        // Lapsed and released holds are noise to the attendee.
        OR: [{ status: { in: ['CONFIRMED', 'CANCELLED'] } }, { status: 'HELD', expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      include: { seat: { include: { event: true } } },
    });

    res.json(
      bookings.map((b) => ({
        id: b.id,
        status: b.status,
        createdAt: b.createdAt,
        expiresAt: b.expiresAt,
        seat: b.seat.label,
        seatId: b.seat.id,
        event: {
          id: b.seat.event.id,
          title: b.seat.event.title,
          venue: b.seat.event.venue,
          startsAt: b.seat.event.startsAt,
          priceCents: b.seat.event.priceCents,
          price: formatPrice(b.seat.event.priceCents),
        },
      }))
    );
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req: AuthRequest, res) => {
    const id = idParam.parse(req.params.id);
    res.json(await cancelBooking(req.user!.id, id));
  })
);

export default router;
