import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useUser } from '../lib/session';
import { formatCountdown, formatDateTime } from '../lib/format';
import { useCountdown } from '../lib/useCountdown';
import type { MyBooking } from '../lib/types';
import Toast, { useToast } from '../components/Toast';
import Spinner from '../components/Spinner';

function HoldRow({ hold, onChange }: { hold: MyBooking; onChange: (message: string, ok: boolean) => void }) {
  const msLeft = useCountdown(hold.expiresAt);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (msLeft !== null && msLeft <= 0) onChange(`Your hold on seat ${hold.seat} ran out, so it's back on sale.`, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msLeft !== null && msLeft <= 0]);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      onChange(success, true);
    } catch (err) {
      onChange(errorMessage(err), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-6 border-[#f59e0b]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <Link to={`/events/${hold.event.id}`} className="font-bold text-lg hover:underline">
          {hold.event.title}
        </Link>
        <div className="text-white/50 text-sm">
          💺 {hold.seat} · {hold.event.price} · held for{' '}
          <span className="font-bold text-[#fcd34d] tabular-nums">{formatCountdown(msLeft ?? 0)}</span> more
        </div>
      </div>
      <div className="flex gap-3">
        <button
          disabled={busy}
          onClick={() => run(() => api(`/holds/${hold.id}/confirm`, { method: 'POST' }), `🎉 Seat ${hold.seat} is booked!`)}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#a855f7] to-[#ec4899] text-sm font-semibold disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          disabled={busy}
          onClick={() => run(() => api(`/holds/${hold.id}`, { method: 'DELETE' }), `Seat ${hold.seat} released.`)}
          className="px-4 py-2 rounded-xl border border-white/20 text-sm text-white/70 disabled:opacity-50"
        >
          Release
        </button>
      </div>
    </div>
  );
}

export default function MyBookingsPage() {
  const user = useUser();
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const { toast, show } = useToast();

  const loadBookings = useCallback(() => {
    api<MyBooking[]>('/bookings/mine')
      .then((data) => {
        setBookings(data);
        setLoadError('');
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (user?.role === 'ATTENDEE') loadBookings();
  }, [user?.role, loadBookings]);

  if (!user) return <Navigate to="/login" state={{ from: '/my-bookings' }} replace />;
  if (user.role !== 'ATTENDEE') {
    return <p className="text-center py-24 text-white/60">Organizer accounts don't have bookings.</p>;
  }
  if (loadError && !bookings) {
    return <p className="text-center py-24 text-[#fca5a5]">⚠️ {loadError}</p>;
  }
  if (!bookings) return <Spinner label="Loading your bookings... 🎟️" />;

  const now = Date.now();
  const holds = bookings.filter((b) => b.status === 'HELD');
  const rest = bookings.filter((b) => b.status !== 'HELD');
  const confirmed = rest.filter((b) => b.status === 'CONFIRMED');
  const upcoming = confirmed.filter((b) => new Date(b.event.startsAt).getTime() > now).length;
  const totalCents = confirmed.reduce((sum, b) => sum + b.event.priceCents, 0);

  const cancelBooking = async (b: MyBooking) => {
    if (!window.confirm(`Cancel your booking for seat ${b.seat} at ${b.event.title}?`)) return;
    try {
      await api(`/bookings/${b.id}/cancel`, { method: 'POST' });
      show('success', 'Booking cancelled ✅');
    } catch (err) {
      show('error', errorMessage(err));
    }
    loadBookings();
  };

  const onHoldChange = (message: string, ok: boolean) => {
    show(ok ? 'success' : 'error', message);
    loadBookings();
  };

  return (
    <div>
      <Toast toast={toast} />

      <h1 className="text-4xl sm:text-5xl font-extrabold mb-2">
        My <span className="gradient-text">Bookings</span> 🎟️
      </h1>
      <p className="text-white/50 mb-10">All your experiences in one place ✨</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
        <div className="glass rounded-2xl p-6">
          <div className="text-white/50 text-sm">Confirmed Bookings</div>
          <div className="text-4xl font-bold gradient-text">{confirmed.length}</div>
        </div>
        <div className="glass rounded-2xl p-6">
          <div className="text-white/50 text-sm">Upcoming</div>
          <div className="text-4xl font-bold gradient-text">{upcoming}</div>
        </div>
        <div className="glass rounded-2xl p-6">
          <div className="text-white/50 text-sm">Ticket Value</div>
          <div className="text-4xl font-bold gradient-text">${(totalCents / 100).toFixed(2)}</div>
        </div>
      </div>

      {holds.length > 0 && (
        <div className="mb-10 space-y-4">
          <h2 className="text-xl font-bold">⏳ Seats held for you</h2>
          {holds.map((h) => (
            <HoldRow key={h.id} hold={h} onChange={onHoldChange} />
          ))}
        </div>
      )}

      {bookings.length === 0 && (
        <div className="text-center py-20 text-white/40">
          <div className="text-6xl">🎭</div>
          <p className="mt-4">No bookings yet!</p>
          <Link to="/" className="text-[#a855f7]">
            Explore events →
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {rest.map((b) => {
          const started = new Date(b.event.startsAt).getTime() <= now;
          const cancelled = b.status === 'CANCELLED';
          return (
            <div
              key={b.id}
              className={`glass rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                cancelled ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-center gap-5 min-w-0">
                <div className="w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-br from-[#a855f7] via-[#ec4899] to-[#f97316] flex items-center justify-center text-2xl">
                  🎭
                </div>
                <div className="min-w-0">
                  <Link to={`/events/${b.event.id}`} className="font-bold text-lg hover:underline break-words">
                    {b.event.title}
                  </Link>
                  <div className="text-white/50 text-sm">
                    📍 {b.event.venue} · 📅 {formatDateTime(b.event.startsAt)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="px-3 py-1 rounded-full bg-[#a855f7]/20 text-[#d8b4fe] text-sm">💺 {b.seat}</span>
                <span className="font-bold">{b.event.price}</span>
                {cancelled ? (
                  <span className="px-3 py-1 rounded-full bg-white/10 text-white/60 text-sm">Cancelled</span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-[#22c55e]/20 text-[#86efac] text-sm">
                    ✓ {started ? 'Past' : 'Confirmed'}
                  </span>
                )}
                {!cancelled && !started && (
                  <button
                    onClick={() => cancelBooking(b)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#ef4444] to-[#dc2626] text-sm font-semibold hover:scale-105 transition-all duration-300"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
