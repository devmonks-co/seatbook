import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useUser } from '../lib/session';
import { formatCountdown, formatDateTime } from '../lib/format';
import { useCountdown } from '../lib/useCountdown';
import type { EventDetail, Seat } from '../lib/types';
import Toast, { useToast } from '../components/Toast';
import Spinner from '../components/Spinner';

const HOLD_MINUTES = 10;
const REFRESH_MS = 15_000;

function seatClass(seat: Seat, selected: boolean, bookable: boolean): string {
  if (seat.mine && seat.status === 'HELD') return 'bg-gradient-to-br from-[#f59e0b] to-[#d97706] ring-2 ring-white scale-110';
  if (seat.mine) return 'bg-gradient-to-br from-[#22c55e] to-[#16a34a]';
  if (selected) return 'bg-gradient-to-br from-[#ec4899] to-[#f97316] shadow-lg shadow-pink-500/50 scale-110';
  if (seat.status === 'HELD') return 'bg-[#f59e0b]/20 text-white/40 border border-dashed border-[#f59e0b]/50 cursor-not-allowed';
  if (seat.status === 'BOOKED') return 'bg-gradient-to-br from-[#a855f7]/20 to-[#6366f1]/20 text-white/30 cursor-not-allowed';
  if (!bookable) return 'bg-gradient-to-br from-[#a855f7]/40 to-[#6366f1]/40 cursor-default';
  return 'bg-gradient-to-br from-[#a855f7]/60 to-[#6366f1]/60 hover:from-[#a855f7] hover:to-[#6366f1] hover:scale-110 cursor-pointer';
}

function seatTitle(seat: Seat): string {
  if (seat.mine) return seat.status === 'HELD' ? `${seat.label}: held for you` : `${seat.label}: your booking`;
  if (seat.status === 'HELD') return `${seat.label}: held by someone else, may come back on sale`;
  if (seat.status === 'BOOKED') return `${seat.label}: booked`;
  return `${seat.label}: available`;
}

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useUser();
  const { toast, show } = useToast();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [selectedSeatId, setSelectedSeatId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<EventDetail>(`/events/${id}`);
      setEvent(data);
      setClockOffset(new Date(data.serverTime).getTime() - Date.now());
      setLoadError(null);
      // Someone else took the seat we were looking at
      setSelectedSeatId((sel) => (sel && data.seats.find((s) => s.id === sel)?.available ? sel : null));
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? 'Event not found' : errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    setEvent(null);
    load();
    // Keep the seat map fresh so holds by others and seats coming back on sale show up.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, user?.id]);

  const myHold = event?.myHold ?? null;
  const msLeft = useCountdown(myHold?.expiresAt, clockOffset);

  // When the countdown runs out, the server has already put the seat back on sale.
  const expiredHoldId = useRef<number | null>(null);
  useEffect(() => {
    if (myHold && msLeft !== null && msLeft <= 0 && expiredHoldId.current !== myHold.id) {
      expiredHoldId.current = myHold.id;
      show('info', `Your hold on seat ${myHold.seatLabel} ran out, so it's back on sale.`);
      load();
    }
  }, [msLeft, myHold, load, show]);

  if (loadError && !event) {
    return (
      <div className="text-center py-24">
        <div className="text-6xl">🤷</div>
        <p className="mt-4 text-white/70">{loadError}</p>
        <Link to="/" className="mt-6 inline-block text-[#a855f7]">
          ← Back to events
        </Link>
      </div>
    );
  }

  if (!event) return <Spinner label="Loading event... 🎭" />;

  const isAttendee = user?.role === 'ATTENDEE';
  const canBook = !event.hasStarted && (!user || isAttendee);
  const selectedSeat = event.seats.find((s) => s.id === selectedSeatId) ?? null;
  const availableCount = event.seats.filter((s) => s.available).length;
  const percentBooked = event.seats.length
    ? Math.round(((event.seats.length - availableCount) / event.seats.length) * 100)
    : 0;

  const rows: Seat[][] = [];
  event.seats.forEach((seat) => {
    (rows[seat.row] ||= []).push(seat);
  });

  function requireLogin(): boolean {
    if (user) return true;
    navigate('/login', { state: { from: location.pathname } });
    return false;
  }

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    try {
      show('success', await fn());
    } catch (err) {
      show('error', errorMessage(err));
    } finally {
      setBusy(false);
      load();
    }
  }

  const holdSeat = (seat: Seat) =>
    requireLogin() &&
    act(async () => {
      await api('/holds', { method: 'POST', body: { seatId: seat.id } });
      setSelectedSeatId(null);
      return `Seat ${seat.label} is held for you for ${HOLD_MINUTES} minutes.`;
    });

  const bookSeat = (seat: Seat) =>
    requireLogin() &&
    act(async () => {
      await api('/bookings', { method: 'POST', body: { seatId: seat.id } });
      setSelectedSeatId(null);
      return `🎉 Seat ${seat.label} is booked!`;
    });

  const confirmHold = () =>
    myHold &&
    act(async () => {
      await api(`/holds/${myHold.id}/confirm`, { method: 'POST' });
      return `🎉 Seat ${myHold.seatLabel} is booked!`;
    });

  const releaseHold = () =>
    myHold &&
    act(async () => {
      await api(`/holds/${myHold.id}`, { method: 'DELETE' });
      return `Seat ${myHold.seatLabel} released.`;
    });

  const holdActive = myHold && msLeft !== null && msLeft > 0;
  const urgent = holdActive && msLeft! < 60_000;

  return (
    <div>
      <Toast toast={toast} />

      <div className="rounded-3xl p-6 sm:p-10 bg-gradient-to-br from-[#a855f7]/30 via-[#ec4899]/20 to-[#f97316]/20 border border-white/10 glow">
        <span className="px-3 py-1 rounded-full bg-[#a855f7]/30 text-[#d8b4fe] text-xs font-bold">
          {event.hasStarted ? '⏰ STARTED' : '✨ UPCOMING'}
        </span>
        <h1 className="mt-4 text-3xl sm:text-5xl font-extrabold break-words">{event.title}</h1>
        {event.description && <p className="mt-4 text-white/60 text-lg whitespace-pre-line">{event.description}</p>}
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-white/70">
          <span>📍 {event.venue}</span>
          <span>📅 {formatDateTime(event.startsAt)}</span>
          <span>👤 {event.organizer.name}</span>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 glass rounded-3xl p-4 sm:p-8 min-w-0">
          <h2 className="text-2xl font-bold mb-2">
            Choose Your <span className="gradient-text">Seat</span> 🪑
          </h2>
          <p className="text-white/50 mb-4">
            {availableCount} of {event.seats.length} available · {percentBooked}% taken
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-white/60 mb-6">
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-[#a855f7]/60" /> Available
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-[#f59e0b]/20 border border-dashed border-[#f59e0b]/50" /> Held by
              someone
            </span>
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-[#a855f7]/20" /> Booked
            </span>
            {user && (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-[#22c55e]" /> Yours
              </span>
            )}
          </div>
          <div className="w-full h-2 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] mb-2 opacity-60"></div>
          <p className="text-center text-xs text-white/40 mb-8">STAGE</p>
          <div className="overflow-x-auto pb-2">
            <div className="space-y-3 w-max mx-auto">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2 sm:gap-3">
                  {row.map((seat) => {
                    const clickable = seat.available && canBook && !myHold;
                    return (
                      <button
                        type="button"
                        key={seat.id}
                        disabled={!clickable}
                        title={seatTitle(seat)}
                        aria-label={seatTitle(seat)}
                        aria-pressed={selectedSeatId === seat.id}
                        onClick={() => setSelectedSeatId(seat.id)}
                        className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-300 ${seatClass(
                          seat,
                          selectedSeatId === seat.id,
                          clickable
                        )}`}
                      >
                        {seat.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass rounded-3xl p-6 sm:p-8 h-fit">
          {holdActive ? (
            <>
              <h3 className="text-xl font-bold mb-2">Seat {myHold.seatLabel} is held for you</h3>
              <p className="text-white/60 text-sm">Nobody else can take it until the timer runs out.</p>
              <div
                className={`mt-6 text-center text-5xl font-extrabold tabular-nums ${urgent ? 'text-[#fca5a5]' : 'gradient-text'}`}
                role="timer"
                aria-label={`${formatCountdown(msLeft!)} left to confirm`}
              >
                {formatCountdown(msLeft!)}
              </div>
              <p className="text-center text-white/50 text-sm mt-1">left to confirm</p>
              <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${urgent ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'}`}
                  style={{ width: `${Math.min(100, (msLeft! / (HOLD_MINUTES * 60_000)) * 100)}%` }}
                />
              </div>
              <div className="mt-6 flex justify-between text-white/70">
                <span>Ticket</span>
                <span className="font-bold text-white">{event.price}</span>
              </div>
              <button
                onClick={confirmHold}
                disabled={busy}
                className="mt-6 w-full py-4 rounded-2xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] font-bold text-lg hover:scale-[1.02] transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100"
              >
                Confirm booking 🎟️
              </button>
              <button
                onClick={releaseHold}
                disabled={busy}
                className="mt-3 w-full py-3 rounded-2xl border border-white/20 text-white/70 hover:bg-white/5 transition-all duration-300 disabled:opacity-50"
              >
                Release seat
              </button>
            </>
          ) : (
            <>
              <h3 className="text-xl font-bold mb-6">Order Summary 🧾</h3>
              <div className="space-y-4 text-white/70">
                <div className="flex justify-between">
                  <span>Seat</span>
                  <span className="font-bold text-white">{selectedSeat ? selectedSeat.label : '—'}</span>
                </div>
                <div className="border-t border-white/10 pt-4 flex justify-between text-xl font-bold text-white">
                  <span>Ticket</span>
                  <span className="gradient-text">{event.price}</span>
                </div>
              </div>

              {event.hasStarted ? (
                <p className="mt-8 text-center text-white/60">This event has started, so booking is closed.</p>
              ) : user && !isAttendee ? (
                <p className="mt-8 text-center text-white/60">
                  You're signed in as an organizer. Use an attendee account to book seats.
                </p>
              ) : (
                <>
                  <button
                    onClick={() => (selectedSeat ? bookSeat(selectedSeat) : show('error', 'Pick a seat first 🪑'))}
                    disabled={busy}
                    className="mt-8 w-full py-4 rounded-2xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] font-bold text-lg hover:scale-[1.02] hover:shadow-2xl hover:shadow-pink-500/40 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {user ? 'Book now 🎟️' : 'Log in to book'}
                  </button>
                  {user && (
                    <button
                      onClick={() => (selectedSeat ? holdSeat(selectedSeat) : show('error', 'Pick a seat first 🪑'))}
                      disabled={busy}
                      className="mt-3 w-full py-3 rounded-2xl border border-[#f59e0b]/60 text-[#fcd34d] hover:bg-[#f59e0b]/10 transition-all duration-300 disabled:opacity-50"
                    >
                      ⏳ Hold for {HOLD_MINUTES} minutes
                    </button>
                  )}
                  <p className="mt-4 text-center text-xs text-white/40">
                    Not sure yet? Hold the seat and nobody else can take it for {HOLD_MINUTES} minutes.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
