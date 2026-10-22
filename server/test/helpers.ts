import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app';
import prisma from '../src/db';
import { signToken } from '../src/middleware/auth';
import { seatLabel } from '../src/utils/helpers';

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE "Booking", "Seat", "Event", "User" RESTART IDENTITY CASCADE');
}

let userCounter = 0;
const passwordHash = bcrypt.hashSync('password123', 4);

export async function createUser(role: 'ORGANIZER' | 'ATTENDEE' = 'ATTENDEE') {
  userCounter++;
  const user = await prisma.user.create({
    data: { email: `user${userCounter}@test.local`, name: `User ${userCounter}`, passwordHash, role },
  });
  return { ...user, token: signToken(user), auth: { Authorization: `Bearer ${signToken(user)}` } };
}

export async function createEvent(opts: { startsAt?: Date; rows?: number; cols?: number } = {}) {
  const organizer = await prisma.user.findFirst({ where: { role: 'ORGANIZER' } }) ?? (await createUser('ORGANIZER'));
  const rows = opts.rows ?? 2;
  const cols = opts.cols ?? 3;
  const seats = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) seats.push({ row: r, col: c, label: seatLabel(r, c) });
  return prisma.event.create({
    data: {
      title: 'Test event',
      description: '',
      venue: 'Hall',
      startsAt: opts.startsAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      rows,
      cols,
      priceCents: 1500,
      organizerId: organizer.id,
      seats: { create: seats },
    },
    include: { seats: { orderBy: { id: 'asc' } } },
  });
}

/** Pretend time has passed for a hold, without fake timers fighting Prisma. */
export async function expireHold(id: number) {
  await prisma.booking.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
}
