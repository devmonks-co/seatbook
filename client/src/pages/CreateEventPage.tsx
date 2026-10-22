import { useState, FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useUser } from '../lib/session';

// Same limits as the API (row labels are A-Z)
const MAX_ROWS = 26;
const MAX_COLS = 30;

const inputClass =
  'w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300';

function clamp(n: number, max: number) {
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), max) : 0;
}

export default function CreateEventPage() {
  const navigate = useNavigate();
  const user = useUser();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [rows, setRows] = useState('5');
  const [cols, setCols] = useState('8');
  const [price, setPrice] = useState('0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return <Navigate to="/login" state={{ from: '/events/new' }} replace />;
  if (user.role !== 'ORGANIZER') {
    return <p className="text-center py-24 text-white/60">Only organizer accounts can create events.</p>;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const priceNumber = Number(price);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      setError('Price must be a number, 0 or more');
      return;
    }
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      setError('Pick a start date and time');
      return;
    }

    setBusy(true);
    try {
      const event = await api<{ id: number }>('/events', {
        method: 'POST',
        body: {
          title,
          description,
          venue,
          startsAt: start.toISOString(),
          rows: Number(rows),
          cols: Number(cols),
          priceCents: Math.round(priceNumber * 100),
        },
      });
      navigate(`/events/${event.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const previewRows = [];
  for (let r = 0; r < clamp(Number(rows), MAX_ROWS); r++) {
    const seats = [];
    for (let c = 0; c < clamp(Number(cols), MAX_COLS); c++) {
      seats.push(String.fromCharCode(65 + r) + (c + 1));
    }
    previewRows.push(seats);
  }

  return (
    <div>
      <h1 className="text-4xl sm:text-5xl font-extrabold mb-2">
        Create <span className="gradient-text">Event</span> ✨
      </h1>
      <p className="text-white/50 mb-10">Bring people together for something amazing 🎉</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <form onSubmit={handleSubmit} className="glass rounded-3xl p-6 sm:p-8 space-y-4">
          <input
            aria-label="Event title"
            placeholder="🎭 Event title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
          <textarea
            aria-label="Description"
            placeholder="📝 Description"
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Venue"
            placeholder="📍 Venue"
            required
            maxLength={200}
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className={inputClass}
          />
          <label className="block text-sm text-white/60">
            Starts at
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block text-sm text-white/60">
              Rows (max {MAX_ROWS})
              <input
                type="number"
                min={1}
                max={MAX_ROWS}
                required
                value={rows}
                onChange={(e) => setRows(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block text-sm text-white/60">
              Seats per row (max {MAX_COLS})
              <input
                type="number"
                min={1}
                max={MAX_COLS}
                required
                value={cols}
                onChange={(e) => setCols(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block text-sm text-white/60">
              Ticket price ($)
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-[#fca5a5] text-sm">
              ⚠️ {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] font-bold text-lg hover:scale-[1.02] hover:shadow-2xl hover:shadow-pink-500/40 transition-all duration-300 disabled:opacity-50"
          >
            Launch Event 🚀
          </button>
        </form>

        <div className="glass rounded-3xl p-6 sm:p-8 min-w-0">
          <h3 className="text-xl font-bold mb-6">Live Preview 👀</h3>
          <div className="overflow-x-auto">
            <div className="space-y-3 w-max mx-auto">
              {previewRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  {row.map((label) => (
                    <div
                      key={label}
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold bg-gradient-to-br from-[#a855f7]/60 to-[#6366f1]/60"
                    >
                      {label}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
