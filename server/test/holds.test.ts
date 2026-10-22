import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/db';
import { expireStaleHolds } from '../src/services/bookingService';
import { api, createEvent, createUser, expireHold, resetDb } from './helpers';

beforeEach(resetDb);

const TEN_MIN = 10 * 60 * 1000;

describe('holds', () => {
  it('holds a seat for 10 minutes and blocks everyone else', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const seatId = event.seats[0].id;

    const hold = await api().post('/holds').set(alice.auth).send({ seatId });
    expect(hold.status).toBe(201);
    expect(hold.body.status).toBe('HELD');
    const remaining = new Date(hold.body.expiresAt).getTime() - new Date(hold.body.serverTime).getTime();
    expect(remaining).toBeGreaterThan(TEN_MIN - 5000);
    expect(remaining).toBeLessThanOrEqual(TEN_MIN);

    expect((await api().post('/holds').set(bob.auth).send({ seatId })).status).toBe(409);
    expect((await api().post('/bookings').set(bob.auth).send({ seatId })).status).toBe(409);
  });

  it('shows the seat as held to others and as "my hold" to the holder', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const seatId = event.seats[0].id;
    await api().post('/holds').set(alice.auth).send({ seatId });

    const anon = await api().get(`/events/${event.id}`);
    expect(anon.body.seats[0]).toMatchObject({ status: 'HELD', available: false, mine: false });
    expect(anon.body.myHold).toBeNull();

    const asBob = await api().get(`/events/${event.id}`).set(bob.auth);
    expect(asBob.body.myHold).toBeNull();

    const asAlice = await api().get(`/events/${event.id}`).set(alice.auth);
    expect(asAlice.body.seats[0].mine).toBe(true);
    expect(asAlice.body.myHold).toMatchObject({ seatId, seatLabel: 'A1' });
    expect(asAlice.body.serverTime).toBeTruthy();

    const mine = await api().get('/bookings/mine').set(alice.auth);
    expect(mine.body[0]).toMatchObject({ status: 'HELD', seat: 'A1' });
    expect(mine.body[0].expiresAt).toBeTruthy();
  });

  it('confirming in time makes it a booking', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const hold = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });

    const confirm = await api().post(`/holds/${hold.body.id}/confirm`).set(alice.auth);
    expect(confirm.status).toBe(200);
    expect(confirm.body).toMatchObject({ status: 'CONFIRMED', expiresAt: null });
    // retrying is harmless
    expect((await api().post(`/holds/${hold.body.id}/confirm`).set(alice.auth)).status).toBe(200);

    const detail = await api().get(`/events/${event.id}`);
    expect(detail.body.seats[0].status).toBe('BOOKED');
  });

  it('booking a seat you hold converts the hold', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const hold = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });
    const book = await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });
    expect(book.status).toBe(201);
    expect(book.body.id).toBe(hold.body.id);
    expect(book.body.status).toBe('CONFIRMED');
  });

  it('an expired hold puts the seat back on sale and can no longer be confirmed', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const seatId = event.seats[0].id;
    const hold = await api().post('/holds').set(alice.auth).send({ seatId });
    await expireHold(hold.body.id);

    // Free immediately on reads, even before the sweeper runs
    const detail = await api().get(`/events/${event.id}`);
    expect(detail.body.seats[0]).toMatchObject({ status: 'AVAILABLE', available: true });

    const confirm = await api().post(`/holds/${hold.body.id}/confirm`).set(alice.auth);
    expect(confirm.status).toBe(410);
    expect(confirm.body.code).toBe('HOLD_EXPIRED');

    const bobHold = await api().post('/holds').set(bob.auth).send({ seatId });
    expect(bobHold.status).toBe(201);

    const old = await prisma.booking.findUnique({ where: { id: hold.body.id } });
    expect(old?.status).toBe('EXPIRED');
  });

  it("an expired hold doesn't show in my bookings", async () => {
    const event = await createEvent();
    const alice = await createUser();
    const hold = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });
    await expireHold(hold.body.id);
    expect((await api().get('/bookings/mine').set(alice.auth)).body).toHaveLength(0);
  });

  it('confirm and someone else grabbing the seat at expiry: exactly one wins', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const seatId = event.seats[0].id;

    for (let i = 0; i < 5; i++) {
      await prisma.booking.deleteMany();
      const hold = await prisma.booking.create({
        data: { seatId, userId: alice.id, status: 'HELD', expiresAt: new Date(Date.now() + 30) },
      });
      await new Promise((r) => setTimeout(r, 30));
      const [confirm, grab] = await Promise.all([
        api().post(`/holds/${hold.id}/confirm`).set(alice.auth),
        api().post('/bookings').set(bob.auth).send({ seatId }),
      ]);
      const live = await prisma.booking.count({ where: { seatId, status: { in: ['HELD', 'CONFIRMED'] } } });
      expect(live).toBe(1);
      expect([confirm.status === 200, grab.status === 201].filter(Boolean)).toHaveLength(1);
    }
  });

  it('can release a hold, which frees the seat', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const seatId = event.seats[0].id;
    const hold = await api().post('/holds').set(alice.auth).send({ seatId });

    expect((await api().delete(`/holds/${hold.body.id}`).set(alice.auth)).status).toBe(204);
    expect((await api().post('/bookings').set(bob.auth).send({ seatId })).status).toBe(201);
    expect((await api().post(`/holds/${hold.body.id}/confirm`).set(alice.auth)).status).toBe(409);
  });

  it("can't confirm or release someone else's hold", async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const hold = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });

    expect((await api().post(`/holds/${hold.body.id}/confirm`).set(bob.auth)).status).toBe(404);
    expect((await api().delete(`/holds/${hold.body.id}`).set(bob.auth)).status).toBe(404);
    expect((await prisma.booking.findUnique({ where: { id: hold.body.id } }))?.status).toBe('HELD');
  });

  it('allows one active hold per event per person, even with parallel requests', async () => {
    const event = await createEvent();
    const other = await createEvent();
    const alice = await createUser();

    const results = await Promise.all(
      event.seats.map((s) => api().post('/holds').set(alice.auth).send({ seatId: s.id }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.code === 'HOLD_LIMIT')).toHaveLength(event.seats.length - 1);

    // A different event is fine
    expect((await api().post('/holds').set(alice.auth).send({ seatId: other.seats[0].id })).status).toBe(201);
  });

  it('holding the seat you already hold is idempotent', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const a = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });
    const b = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.expiresAt).toBe(a.body.expiresAt); // doesn't extend the clock
  });

  it("can't immediately re-hold a seat whose hold just ended, but can still book it", async () => {
    const event = await createEvent();
    const alice = await createUser();
    const seatId = event.seats[0].id;
    const hold = await api().post('/holds').set(alice.auth).send({ seatId });
    await expireHold(hold.body.id);

    const rehold = await api().post('/holds').set(alice.auth).send({ seatId });
    expect(rehold.status).toBe(409);
    expect(rehold.body.code).toBe('HOLD_COOLDOWN');

    // Release has the same rule, otherwise release + hold extends forever
    const seat2 = event.seats[1].id;
    const h2 = await api().post('/holds').set(alice.auth).send({ seatId: seat2 });
    await api().delete(`/holds/${h2.body.id}`).set(alice.auth);
    expect((await api().post('/holds').set(alice.auth).send({ seatId: seat2 })).body.code).toBe('HOLD_COOLDOWN');

    expect((await api().post('/bookings').set(alice.auth).send({ seatId })).status).toBe(201);
  });

  it('can hold the same seat again once the cooldown has passed', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const seatId = event.seats[0].id;
    const hold = await api().post('/holds').set(alice.auth).send({ seatId });
    await prisma.booking.update({
      where: { id: hold.body.id },
      data: { expiresAt: new Date(Date.now() - TEN_MIN - 1000) },
    });
    expect((await api().post('/holds').set(alice.auth).send({ seatId })).status).toBe(201);
  });

  it('a hold never lasts past the start of the event', async () => {
    const startsAt = new Date(Date.now() + 2 * 60 * 1000);
    const event = await createEvent({ startsAt });
    const alice = await createUser();
    const hold = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });
    expect(new Date(hold.body.expiresAt).getTime()).toBe(startsAt.getTime());
  });

  it('organizers and anonymous users cannot hold', async () => {
    const event = await createEvent();
    const organizer = await createUser('ORGANIZER');
    expect((await api().post('/holds').set(organizer.auth).send({ seatId: event.seats[0].id })).status).toBe(403);
    expect((await api().post('/holds').send({ seatId: event.seats[0].id })).status).toBe(401);
  });

  it('the sweeper marks lapsed holds as expired', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const hold = await api().post('/holds').set(alice.auth).send({ seatId: event.seats[0].id });
    await expireHold(hold.body.id);
    const { count } = await expireStaleHolds();
    expect(count).toBe(1);
    expect((await prisma.booking.findUnique({ where: { id: hold.body.id } }))?.status).toBe('EXPIRED');
  });
});
