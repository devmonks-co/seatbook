import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/db';
import { api, createEvent, createUser, resetDb } from './helpers';

beforeEach(resetDb);

describe('bookings', () => {
  it('books a seat and shows it in my bookings', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const res = await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');

    const mine = await api().get('/bookings/mine').set(alice.auth);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ seat: 'A1', status: 'CONFIRMED' });
  });

  it('never double books a seat under concurrent requests', async () => {
    const event = await createEvent();
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser()));
    const seatId = event.seats[0].id;

    // Half try to book outright, half try to hold, all at once
    const results = await Promise.all(
      users.map((u, i) => api().post(i % 2 ? '/bookings' : '/holds').set(u.auth).send({ seatId }))
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
  });

  it("can't book a taken seat, an unknown seat or a started event", async () => {
    const event = await createEvent();
    const past = await createEvent({ startsAt: new Date(Date.now() - 1000) });
    const alice = await createUser();
    const bob = await createUser();

    await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });
    const taken = await api().post('/bookings').set(bob.auth).send({ seatId: event.seats[0].id });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SEAT_UNAVAILABLE');

    expect((await api().post('/bookings').set(bob.auth).send({ seatId: 99999 })).status).toBe(404);
    expect((await api().post('/bookings').set(bob.auth).send({ seatId: 'abc' })).status).toBe(400);
    expect((await api().post('/bookings').set(bob.auth).send({})).status).toBe(400);
    expect((await api().post('/bookings').set(bob.auth).send({ seatId: past.seats[0].id })).status).toBe(409);
  });

  it('only attendees can book', async () => {
    const event = await createEvent();
    const organizer = await createUser('ORGANIZER');
    expect((await api().post('/bookings').set(organizer.auth).send({ seatId: event.seats[0].id })).status).toBe(403);
    expect((await api().post('/bookings').send({ seatId: event.seats[0].id })).status).toBe(401);
  });

  it("can't cancel someone else's booking", async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const booking = await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });

    const attempt = await api().post(`/bookings/${booking.body.id}/cancel`).set(bob.auth);
    expect(attempt.status).toBe(404);

    const mine = await api().get('/bookings/mine').set(alice.auth);
    expect(mine.body[0].status).toBe('CONFIRMED');
  });

  it('cancelling frees the seat for someone else', async () => {
    const event = await createEvent();
    const alice = await createUser();
    const bob = await createUser();
    const booking = await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });

    const cancel = await api().post(`/bookings/${booking.body.id}/cancel`).set(alice.auth);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    // idempotent
    expect((await api().post(`/bookings/${booking.body.id}/cancel`).set(alice.auth)).status).toBe(200);

    const rebook = await api().post('/bookings').set(bob.auth).send({ seatId: event.seats[0].id });
    expect(rebook.status).toBe(201);
  });

  it("can't cancel after the event has started", async () => {
    const event = await createEvent();
    const alice = await createUser();
    const booking = await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });
    await prisma.event.update({ where: { id: event.id }, data: { startsAt: new Date(Date.now() - 1000) } });

    const res = await api().post(`/bookings/${booking.body.id}/cancel`).set(alice.auth);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_STARTED');
  });
});
