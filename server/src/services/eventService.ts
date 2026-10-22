import prisma from '../db';
import { formatPrice } from '../utils/helpers';
import { activeBookingWhere } from './bookingService';

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED';

export async function listEvents() {
  const now = new Date();
  const [events, occupied] = await Promise.all([
    prisma.event.findMany({
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { seats: true } } },
    }),
    // Seats taken per event: confirmed bookings plus holds that haven't run out.
    // (The old code counted every booking row, cancelled ones included.)
    // Not raw SQL on purpose: the columns are timestamp without time zone, and
    // comparing them to a bound Date shifts by the DB session's timezone.
    prisma.seat.groupBy({
      by: ['eventId'],
      where: { bookings: { some: activeBookingWhere(now) } },
      _count: { _all: true },
    }),
  ]);
  const takenByEvent = new Map(occupied.map((r) => [r.eventId, r._count._all]));

  return events.map((event) => {
    const totalSeats = event._count.seats;
    const hasStarted = event.startsAt <= now;
    return {
      id: event.id,
      title: event.title,
      venue: event.venue,
      startsAt: event.startsAt,
      priceCents: event.priceCents,
      price: formatPrice(event.priceCents),
      totalSeats,
      seatsLeft: hasStarted ? 0 : totalSeats - (takenByEvent.get(event.id) ?? 0),
    };
  });
}

export async function getEventWithSeats(eventId: number, viewerId?: number) {
  const now = new Date();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      organizer: { select: { id: true, name: true } },
      seats: {
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
        include: { bookings: { where: activeBookingWhere(now) } },
      },
    },
  });
  if (!event) return null;

  const hasStarted = event.startsAt <= now;
  let myHold: { id: number; seatId: number; seatLabel: string; expiresAt: Date } | null = null;

  const seats = event.seats.map((seat) => {
    // The partial unique index guarantees at most one.
    const active = seat.bookings[0];
    const status: SeatStatus = !active ? 'AVAILABLE' : active.status === 'HELD' ? 'HELD' : 'BOOKED';
    const mine = !!active && viewerId !== undefined && active.userId === viewerId;
    if (mine && active.status === 'HELD') {
      myHold = { id: active.id, seatId: seat.id, seatLabel: seat.label, expiresAt: active.expiresAt! };
    }
    return {
      id: seat.id,
      row: seat.row,
      col: seat.col,
      label: seat.label,
      status,
      mine,
      available: status === 'AVAILABLE' && !hasStarted,
    };
  });

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: event.startsAt,
    hasStarted,
    priceCents: event.priceCents,
    price: formatPrice(event.priceCents),
    rows: event.rows,
    cols: event.cols,
    organizer: event.organizer,
    seats,
    myHold,
    // Lets the client correct for a wrong device clock when counting down a hold.
    serverTime: now,
  };
}
