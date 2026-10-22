import { Booking, Prisma } from '@prisma/client';
import prisma from '../db';
import { config } from '../config';
import { HttpError, isUniqueViolation } from '../lib/errors';

type Tx = Prisma.TransactionClient;

const HOLD_MS = config.holdMinutes * 60 * 1000;
// After a hold on a seat ends, the same person can't hold that seat again for
// this long. Without it "goes back on sale" isn't true: someone could re-hold
// the instant it lapses, forever. They can still book it outright.
const REHOLD_COOLDOWN_MS = HOLD_MS;

/** A booking row that currently occupies its seat. */
export function activeBookingWhere(now: Date): Prisma.BookingWhereInput {
  return {
    OR: [{ status: 'CONFIRMED' }, { status: 'HELD', expiresAt: { gt: now } }],
  };
}

export async function expireStaleHolds(now = new Date()) {
  return prisma.booking.updateMany({
    where: { status: 'HELD', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
}

/**
 * Serializes all hold/booking writes by the same user, so "one hold per event"
 * can't be bypassed by firing requests in parallel. Different users don't block
 * each other here; competition for a seat is settled by the partial unique index.
 */
async function lockUser(tx: Tx, userId: number) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

async function loadBookableSeat(tx: Tx, seatId: number, now: Date) {
  const seat = await tx.seat.findUnique({ where: { id: seatId }, include: { event: true } });
  if (!seat) throw new HttpError(404, 'Seat not found', 'NOT_FOUND');
  if (seat.event.startsAt <= now) {
    throw new HttpError(409, 'This event has already started', 'EVENT_STARTED');
  }
  return seat;
}

/** The seat's hold has lapsed but nobody marked it yet: free the slot in the unique index. */
async function expireHoldsOnSeat(tx: Tx, seatId: number, now: Date) {
  await tx.booking.updateMany({
    where: { seatId, status: 'HELD', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
}

function seatTaken(): HttpError {
  return new HttpError(409, 'Sorry, someone else has just taken or is holding this seat', 'SEAT_UNAVAILABLE');
}

async function run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn);
  } catch (err) {
    if (isUniqueViolation(err)) throw seatTaken();
    throw err;
  }
}

export async function holdSeat(userId: number, seatId: number): Promise<Booking> {
  return run(async (tx) => {
    const now = new Date();
    await lockUser(tx, userId);
    const seat = await loadBookableSeat(tx, seatId, now);
    await expireHoldsOnSeat(tx, seatId, now);

    const existing = await tx.booking.findFirst({
      where: { seatId, ...activeBookingWhere(now) },
    });
    if (existing) {
      if (existing.userId !== userId) throw seatTaken();
      if (existing.status === 'HELD') return existing; // idempotent: holding your own hold again
      throw new HttpError(409, 'You have already booked this seat', 'ALREADY_BOOKED');
    }

    const otherHold = await tx.booking.findFirst({
      where: { userId, status: 'HELD', expiresAt: { gt: now }, seat: { eventId: seat.eventId } },
      include: { seat: true },
    });
    if (otherHold) {
      throw new HttpError(
        409,
        `You're already holding seat ${otherHold.seat.label} for this event. Book or release it first.`,
        'HOLD_LIMIT'
      );
    }

    const cooldownStart = new Date(now.getTime() - REHOLD_COOLDOWN_MS);
    const recentHold = await tx.booking.findFirst({
      where: {
        userId,
        seatId,
        OR: [
          { status: { in: ['EXPIRED', 'HELD'] }, expiresAt: { gt: cooldownStart } },
          { status: 'RELEASED', releasedAt: { gt: cooldownStart } },
        ],
      },
    });
    if (recentHold) {
      throw new HttpError(
        409,
        `You held this seat a few minutes ago. You can book it now, or hold it again after a ${config.holdMinutes} minute break.`,
        'HOLD_COOLDOWN'
      );
    }

    // A hold never outlives the event's start.
    const expiresAt = new Date(Math.min(now.getTime() + HOLD_MS, seat.event.startsAt.getTime()));
    return tx.booking.create({ data: { seatId, userId, status: 'HELD', expiresAt } });
  });
}

/** Book a seat outright. If the user is holding it, the hold becomes the booking. */
export async function bookSeat(userId: number, seatId: number): Promise<Booking> {
  return run(async (tx) => {
    const now = new Date();
    await lockUser(tx, userId);
    await loadBookableSeat(tx, seatId, now);
    await expireHoldsOnSeat(tx, seatId, now);

    const existing = await tx.booking.findFirst({ where: { seatId, ...activeBookingWhere(now) } });
    if (existing) {
      if (existing.userId !== userId) throw seatTaken();
      if (existing.status === 'CONFIRMED') {
        throw new HttpError(409, 'You have already booked this seat', 'ALREADY_BOOKED');
      }
      return tx.booking.update({
        where: { id: existing.id },
        data: { status: 'CONFIRMED', confirmedAt: now, expiresAt: null },
      });
    }

    return tx.booking.create({ data: { seatId, userId, status: 'CONFIRMED', confirmedAt: now } });
  });
}

export async function confirmHold(userId: number, holdId: number): Promise<Booking> {
  const now = new Date();
  // Single conditional UPDATE: the check and the write can't be split by a
  // concurrent expiry, release or another confirm.
  const { count } = await prisma.booking.updateMany({
    where: { id: holdId, userId, status: 'HELD', expiresAt: { gt: now } },
    data: { status: 'CONFIRMED', confirmedAt: now, expiresAt: null },
  });

  const booking = await prisma.booking.findFirst({ where: { id: holdId, userId } });
  if (!booking) throw new HttpError(404, 'Hold not found', 'NOT_FOUND');
  if (count === 1) return booking;

  if (booking.status === 'CONFIRMED') return booking; // already confirmed (double click, retry)
  if (booking.status === 'HELD' || booking.status === 'EXPIRED') {
    throw new HttpError(410, 'Your hold has expired and the seat is back on sale', 'HOLD_EXPIRED');
  }
  throw new HttpError(409, 'This hold was released', 'HOLD_RELEASED');
}

export async function releaseHold(userId: number, holdId: number): Promise<void> {
  const now = new Date();
  const { count } = await prisma.booking.updateMany({
    where: { id: holdId, userId, status: 'HELD' },
    data: { status: 'RELEASED', releasedAt: now },
  });
  if (count === 0) {
    const booking = await prisma.booking.findFirst({ where: { id: holdId, userId } });
    if (!booking) throw new HttpError(404, 'Hold not found', 'NOT_FOUND');
    if (booking.status === 'CONFIRMED') {
      throw new HttpError(409, 'This seat is already booked. Cancel the booking instead.', 'ALREADY_BOOKED');
    }
    // Already released or expired: nothing to do.
  }
}

export async function cancelBooking(userId: number, bookingId: number): Promise<Booking> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { seat: { include: { event: true } } },
  });
  // Someone else's booking looks exactly like a missing one.
  if (!booking) throw new HttpError(404, 'Booking not found', 'NOT_FOUND');
  if (booking.status === 'CANCELLED') return booking;
  if (booking.status !== 'CONFIRMED') throw new HttpError(409, 'Only confirmed bookings can be cancelled', 'NOT_CANCELLABLE');
  if (booking.seat.event.startsAt <= new Date()) {
    throw new HttpError(409, "This event has already started, so the booking can't be cancelled", 'EVENT_STARTED');
  }

  const { count } = await prisma.booking.updateMany({
    where: { id: bookingId, userId, status: 'CONFIRMED' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  if (count === 0) throw new HttpError(409, 'This booking changed. Please refresh and try again.', 'CONFLICT');
  return prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
}
