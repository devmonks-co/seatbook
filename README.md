# Seatbook

Seat booking for small venues. Organizers publish an event with a seat grid, attendees pick a seat and book it.

## Stack

- **server/**: Node, Express, TypeScript, Prisma, Postgres
- **client/**: React, Vite, TypeScript, Tailwind

## Run it

```bash
docker compose up --build
```

- App: http://localhost:5173
- API: http://localhost:4000
- Postgres: `localhost:5433` (user / password / db: `seatbook`)

The database is migrated and seeded on first start. To start from a clean database: `docker compose down -v`.

After pulling these changes, rebuild (`docker compose up --build`): there are new dependencies and migrations.

**After changing `schema.prisma`:** create the migration from your machine (`cd server && npx prisma migrate dev`, with `DATABASE_URL` pointing at `localhost:5433`), then `docker compose restart server`. The server regenerates the Prisma client and applies migrations on start.

### Seeded accounts

All passwords are `password123`.

| Email | Role |
|---|---|
| organizer@seatbook.test | Organizer |
| alice@seatbook.test | Attendee |
| bob@seatbook.test | Attendee |

### Without Docker

```bash
cd server && cp .env.example .env && npm install && npm run db:migrate && npm run db:seed && npm run dev
cd client && npm install && npm run dev
```

You need a Postgres running at the `DATABASE_URL` in `server/.env`.

### Configuration (server)

| Variable | Required | |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | 32+ random characters (`openssl rand -hex 32`). The server refuses to start without it. |
| `CORS_ORIGIN` | no | Comma-separated browser origins allowed to call the API. Default `http://localhost:5173` |
| `TRUST_PROXY` | no | Number of reverse proxies in front of the API, so rate limiting sees real client IPs |
| `TEST_DATABASE_URL` | for tests | A separate database (name must contain `test`). The tests wipe it. |
| `NODE_ENV` | no | `production` stops the seed script from creating the demo accounts |

## Scripts

| | server | client |
|---|---|---|
| `npm run dev` | API with reload | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` | `tsc --noEmit` |
| `npm test` | Vitest integration tests against `TEST_DATABASE_URL` | none yet |

Run the server tests in Docker with `docker compose exec server npm test`.

## API

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/auth/register` | none | Create an account, returns a token |
| POST | `/auth/login` | none | Log in, returns a token |
| GET | `/events` | none | List events with seats left |
| POST | `/events` | organizer | Create an event and its seats |
| GET | `/events/:id` | optional | With a token, also returns `myHold` and marks your seats |
| POST | `/bookings` | attendee | Book a seat outright (converts your hold on it, if any) |
| GET | `/bookings/mine` | attendee | Your bookings and active holds |
| POST | `/bookings/:id/cancel` | attendee | Cancel your booking (until the event starts) |
| POST | `/holds` | attendee | Hold a seat for 10 minutes. Body `{ seatId }` |
| POST | `/holds/:id/confirm` | attendee | Turn your hold into a booking, if it hasn't expired (410 if it has) |
| DELETE | `/holds/:id` | attendee | Release your hold |

Send the token as `Authorization: Bearer <token>`. Errors are always `{ "error": "<readable message>", "code": "<MACHINE_CODE>" }`.

---

# Handover note

Seatbook is now safe enough to take bookings from real people, with one exception: **it can't take money yet** (see "Before launch"). Seat holds are in. I kept every existing flow working and kept Mr. Rahman's design.

## What I changed and why

I started by attacking the original app to see what was really broken, rather than guessing. Each of these was reproduced against the original code, fixed, and now has a test:

| Problem in the original | Impact | Fix |
|---|---|---|
| Booking checked "is the seat free?" and then inserted, separately | 20 parallel requests for one seat produced **3 bookings** | A partial unique index in Postgres allows one live (held or confirmed) booking per seat. The database decides, not app code. |
| `POST /bookings/:id/cancel` didn't check who owned the booking | Any user could cancel anyone's booking | Ownership check; someone else's booking returns 404, the same as a missing one |
| JWT secret hardcoded in the source (`seatbook-secret-123`) | Anyone who read the repo could forge an organizer login | `JWT_SECRET` from env, required, 32+ chars; the role is read from the DB on every request, not trusted from the token |
| Async errors in Express 4 weren't caught | `POST /auth/login` with `{}` **crashed the whole API** for everyone | Async wrapper and a central error handler; internal errors are logged, never sent to clients |
| No input validation anywhere | Password `"1"`, negative prices, `rows: "abc"`, invalid dates all reached the DB | zod schemas on every input; readable 400s |
| `seatsLeft` counted cancelled bookings | The event list showed fewer seats than were really free | Counts only confirmed bookings and live holds |
| `server/.env` was never loaded | The "Without Docker" instructions didn't work | `dotenv` |
| Client hardcoded `http://localhost:4000` on 2 pages | The app would break anywhere but a laptop | One API helper that uses `VITE_API_URL` |

Also: rate limiting on login (failed attempts) and signup; `helmet`; CORS limited to configured origins; consistent error shape; 404s instead of `200 {success:false}`; only attendees can book; no cancelling after an event starts; the seed script won't create the demo accounts (`password123`) when `NODE_ENV=production`; graceful shutdown; indexes on `Booking`.

In the UI: holds (below), real error messages, a role choice on signup (the API supported it, but the UI never offered it), an expired session logs you out instead of failing silently, My Bookings no longer hangs when you're logged out and no longer offers to cancel cancelled bookings, the create-event preview can't freeze the tab, and the layouts work on a phone. I **removed** UI that promised things the system doesn't do: a 5% "service fee" the server never charged, "Secure checkout · Instant confirmation", "100% Satisfaction", and "LIVE NOW" on events that hadn't started.

### Holds

- An attendee picks a seat and either **books it now** (as before) or **holds it for 10 minutes**. While it's held, nobody else can hold or book it. Others see it as "held by someone" so they know it may come back.
- The holder sees a countdown, **Confirm booking** and **Release seat**, on the event page and in My Bookings. The countdown uses the server's clock (the API returns `serverTime`), so a phone with the wrong time still shows the deadline the server will enforce.
- If they confirm in time, it becomes a normal booking. If not, the seat is back on sale **the instant the time passes**. Nothing waits for a background job: every read treats a lapsed hold as free, and every write clears a lapsed hold on that seat before claiming it. A sweep every minute just tidies the status column.
- Confirming is a single conditional `UPDATE ... WHERE status='HELD' AND expiresAt > now`, so "confirm at 9:59" and "someone else grabs it at 10:00" can't both win. There's a test that races them.
- Data model: a hold is a `Booking` row with `status = HELD` and an `expiresAt`. It ends as `CONFIRMED`, `RELEASED` or `EXPIRED`. Keeping one table means the single unique index covers holds and bookings together.

### Decisions I made where the request was open

- **Holds are optional.** "Book now" still works in one step; holding is for people who want time to decide.
- **One active hold per person per event.** Without a limit, one account could hold a whole room. Booking several seats outright still works.
- **No back-to-back re-holding.** After your hold on a seat ends (expired or released), you can't hold *that* seat again for 10 minutes. You can still book it. Otherwise "it goes back on sale" isn't true: someone could re-hold the instant it lapses, forever.
- Holding a seat you already hold returns the same hold and **does not reset the timer**.
- A hold never lasts past the event's start time.
- Organizers can't book or hold (the original README already said bookings were attendee-only).
- **Anyone can still sign up as an organizer**, because the brief lists it as existing behaviour. That means anyone can publish events on Mr. Rahman's site; see below.
- Attendees can cancel until the event starts, not after.
- Lapsed and released holds don't appear in My Bookings.

## What I'd still do before launch

Blocking:
1. **Payments.** Events have prices, but "Confirm" books the seat without taking money. A hold is where payment fits: hold → pay → confirm. I didn't build it (out of scope). Until it exists, only run free events or collect payment at the door.
2. **Decide who can be an organizer.** Today anyone can sign up as one and publish events. I'd make organizer accounts invite-only or approved by Mr. Rahman.
3. **Production build and run.** Both containers run dev servers (`tsx watch`, Vite dev) and seed on start. Production needs a built client served as static files, a compiled server, `prisma migrate deploy` as a release step, no seeding, a real DB password, and Postgres backups.
4. **Password reset.** People will forget passwords, and right now only someone with database access can help them. Email verification goes with it.
5. **Currency.** Prices show as `$` for a business in Dhaka. Confirm with Mr. Rahman whether this should be taka.

Soon after:
- Move the session token from `localStorage` to an httpOnly cookie (with CSRF protection), and add a way to revoke sessions (tokens currently last 7 days).
- Rate limit counters are in memory: fine for one server process, but they need Redis or similar if the API ever runs on several instances.
- Error tracking (e.g. Sentry), structured logs, uptime checks.
- CI running typecheck, server tests and a browser test on every push.
- Organizers can't see who booked, or edit or cancel an event. Not asked for, but Mr. Rahman will want it.

## Weakest part

**The client has no automated tests.** The hold UI (countdown, expiry, refreshing the seat map) is the part users touch most, and I checked it with a throwaway Playwright script (below), not with tests in the repo. A change to the event page could break it without anything failing. Close second: the seat map **polls every 15 seconds**, so for up to 15 seconds you can see a seat as free that someone just took. The server still rejects the second booking with a clear message, so it's a UX gap, not a correctness one. At this venue size, polling beats running websockets.

## One place the AI was wrong

To count free seats per event, the AI (Claude Code) wrote a raw SQL query comparing `Booking."expiresAt"` to a JS `Date` parameter. It typechecked and looked right. The integration test caught it: live holds were counted as expired. The columns are `timestamp without time zone`, and the bound parameter is interpreted in the **database session's timezone**. My local Postgres was running in Dhaka time (+06), so every hold looked 6 hours old. The Docker Postgres runs in UTC, so in Docker it would have passed and then broken whenever the database's timezone setting changed. The fix was to use Prisma's query builder for the count, so every timestamp goes through the same path (`server/src/services/eventService.ts`). The lesson I took: date logic gets a test against a real database, not a read-through.

(The AI also wrote one concurrency test that was itself wrong: it expected exactly one success when the same user both holds and books a seat, but converting your own hold is meant to succeed. I fixed the test, not the code.)

## How I checked it works

- **Reproduced the bugs first.** A script made 20 parallel booking requests, cancelled another user's booking, forged a JWT with the old secret, and sent an empty login. Against the original code: 3 double bookings, a cancelled stranger's booking, a forged organizer event, and the API process died. Against the new code: 1 booking and 19 × 409, 404, 401, 400, and the server stays up.
- **38 integration tests** (`server/test/`) run against a real Postgres, not mocks, because the bugs that matter here (races, expiry, timezones) only show up in a real database. They cover auth, validation, the booking race (20 parallel users, one winner), ownership, the hold lifecycle (confirm, release, expiry, cooldown, one per event even with parallel requests, capped at event start), and confirm-versus-grab at the moment of expiry. I ran the suite 5 times in a row to check for flakiness.
- **Checked that the tests can fail.** With the unique index removed from the migration, the race test fails.
- **Ran the migration on a database that already contained the double bookings.** It refuses to apply, rolls back cleanly, and the migration file says how to find and fix the duplicates.
- **Clicked through it in a real browser** (headless Chromium via Playwright, desktop and phone widths): Alice holds C3 and watches the countdown tick. Bob sees C3 as held and can't select it. Alice confirms, and it shows in My Bookings. Bob holds D1, the hold is shortened to 5 seconds, and the page tells him it ran out and shows D1 as available again. No console errors.
- `npm run typecheck` (both) and `npm run build` (client) pass.
- **Not checked:** I didn't have Docker on the machine I used, so I tested against Postgres 18 run directly rather than through `docker compose` (Postgres 16). The compose file only gained environment variables, but run `docker compose up --build` once before relying on it.
