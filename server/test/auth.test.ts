import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import prisma from '../src/db';
import { api, createEvent, createUser, resetDb } from './helpers';

beforeEach(resetDb);

describe('auth', () => {
  it('registers an attendee by default and logs in case-insensitively', async () => {
    const reg = await api()
      .post('/auth/register')
      .send({ email: ' New@Example.com ', password: 'longenough', name: 'New' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'new@example.com', role: 'ATTENDEE' });
    expect(reg.body.user.passwordHash).toBeUndefined();

    const login = await api().post('/auth/login').send({ email: 'NEW@example.com', password: 'longenough' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('can register an organizer when asked', async () => {
    const reg = await api()
      .post('/auth/register')
      .send({ email: 'org@example.com', password: 'longenough', name: 'Org', role: 'ORGANIZER' });
    expect(reg.body.user.role).toBe('ORGANIZER');
  });

  it('rejects weak or malformed signups with a readable error', async () => {
    const short = await api().post('/auth/register').send({ email: 'a@b.co', password: '1', name: 'x' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/password/);

    const badRole = await api()
      .post('/auth/register')
      .send({ email: 'a@b.co', password: 'longenough', name: 'x', role: 'ADMIN' });
    expect(badRole.status).toBe(400);
  });

  it('returns 409 for a duplicate email without leaking database errors', async () => {
    const body = { email: 'dup@example.com', password: 'longenough', name: 'Dup' };
    await api().post('/auth/register').send(body);
    const again = await api().post('/auth/register').send(body);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('An account with this email already exists');
  });

  it('survives malformed login requests (used to crash the process)', async () => {
    expect((await api().post('/auth/login').send({})).status).toBe(400);
    expect((await api().post('/auth/login').set('content-type', 'application/json').send('{bad')).status).toBe(400);
    expect((await api().post('/auth/login').send({ email: ['x'], password: {} })).status).toBe(400);
    expect((await api().get('/health')).status).toBe(200);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const user = await createUser();
    const wrongPw = await api().post('/auth/login').send({ email: user.email, password: 'nope-nope' });
    const noUser = await api().post('/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it('rejects tokens signed with the old hardcoded secret', async () => {
    const forged = jwt.sign({ id: 1, sub: '1', role: 'ORGANIZER' }, 'seatbook-secret-123');
    const res = await api()
      .post('/events')
      .set('Authorization', `Bearer ${forged}`)
      .send({ title: 'x', venue: 'y', startsAt: new Date(Date.now() + 1e7).toISOString(), rows: 1, cols: 1 });
    expect(res.status).toBe(401);
  });

  it('uses the role from the database, not the token', async () => {
    const user = await createUser('ORGANIZER');
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ATTENDEE' } });
    const res = await api()
      .post('/events')
      .set(user.auth)
      .send({ title: 'x', venue: 'y', startsAt: new Date(Date.now() + 1e7).toISOString(), rows: 1, cols: 1 });
    expect(res.status).toBe(403);
  });

  it('rate limits repeated failed logins', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await api().post('/auth/login').send({ email: 'ghost@test.local', password: 'wrong-wrong' })).status;
    }
    expect(last).toBe(429);
  });
});

describe('events', () => {
  it('lets organizers create events and validates the input', async () => {
    const organizer = await createUser('ORGANIZER');
    const attendee = await createUser();
    const valid = {
      title: 'Talk',
      venue: 'Hall',
      startsAt: new Date(Date.now() + 86400_000).toISOString(),
      rows: 3,
      cols: 4,
      priceCents: 2500,
    };

    expect((await api().post('/events').set(attendee.auth).send(valid)).status).toBe(403);
    expect((await api().post('/events').send(valid)).status).toBe(401);

    for (const bad of [
      { rows: 0 },
      { rows: 27 },
      { cols: 2.5 },
      { cols: '4' },
      { priceCents: -1 },
      { startsAt: 'tomorrow' },
      { startsAt: new Date(Date.now() - 1000).toISOString() },
      { title: '   ' },
    ]) {
      const res = await api().post('/events').set(organizer.auth).send({ ...valid, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }

    const created = await api().post('/events').set(organizer.auth).send(valid);
    expect(created.status).toBe(201);
    const detail = await api().get(`/events/${created.body.id}`);
    expect(detail.body.seats).toHaveLength(12);
    expect(detail.body.seats[11].label).toBe('C4');
  });

  it('returns 404 for unknown or malformed ids', async () => {
    expect((await api().get('/events/999')).status).toBe(404);
    expect((await api().get('/events/abc')).status).toBe(404);
  });

  it('counts seats left from live bookings only', async () => {
    const event = await createEvent({ rows: 1, cols: 4 });
    const alice = await createUser();
    const bob = await createUser();

    await api().post('/bookings').set(alice.auth).send({ seatId: event.seats[0].id });
    const b = await api().post('/bookings').set(bob.auth).send({ seatId: event.seats[1].id });
    await api().post(`/bookings/${b.body.id}/cancel`).set(bob.auth);
    await api().post('/holds').set(bob.auth).send({ seatId: event.seats[2].id });

    const list = await api().get('/events');
    // 4 seats - 1 booked - 1 held (the cancelled one is free again)
    expect(list.body[0]).toMatchObject({ totalSeats: 4, seatsLeft: 2 });
  });
});
