import { useState, FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import GradientButton from '../components/GradientButton';
import { api, errorMessage } from '../lib/api';
import { saveSession } from '../lib/session';
import type { Role, User } from '../lib/types';

const inputClass =
  'w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('ATTENDEE');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api<{ token: string; user: User }>(`/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        auth: false,
        body: isLogin ? { email, password } : { email, password, name, role },
      });
      saveSession(data.token, data.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || (data.user.role === 'ORGANIZER' ? '/events/new' : '/'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex justify-center py-10">
      <div className="glass rounded-3xl p-6 sm:p-10 w-full max-w-[440px] glow">
        <div className="text-center mb-8">
          <div className="text-6xl animate-float">🎟️</div>
          <h1 className="mt-4 text-4xl font-extrabold">
            {isLogin ? 'Welcome ' : 'Join '}
            <span className="gradient-text">{isLogin ? 'Back!' : 'Seatbook!'}</span>
          </h1>
          <p className="mt-2 text-white/50">
            {isLogin ? 'Sign in to continue ✨' : 'Create an account to book seats 🚀'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <input
                aria-label="Full name"
                placeholder="👤 Full name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
              <fieldset className="grid grid-cols-2 gap-3">
                <legend className="sr-only">Account type</legend>
                {(['ATTENDEE', 'ORGANIZER'] as const).map((r) => (
                  <label
                    key={r}
                    className={`cursor-pointer text-center px-4 py-3 rounded-2xl border transition-all duration-300 ${
                      role === r ? 'border-[#a855f7] bg-[#a855f7]/20' : 'border-white/10 bg-white/5 text-white/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={role === r}
                      onChange={() => setRole(r)}
                      className="sr-only"
                    />
                    {r === 'ATTENDEE' ? '🎟️ I want to attend' : '🎤 I run events'}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <input
            type="email"
            aria-label="Email address"
            placeholder="📧 Email address"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            aria-label="Password"
            placeholder={isLogin ? '🔒 Password' : '🔒 Password (at least 8 characters)'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            minLength={isLogin ? undefined : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {error && (
            <p role="alert" className="text-[#fca5a5] text-sm">
              ⚠️ {error}
            </p>
          )}
          <GradientButton type="submit" disabled={busy}>
            {isLogin ? 'Sign In 🚀' : 'Create Account ✨'}
          </GradientButton>
        </form>
        <p className="mt-6 text-center text-white/50">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-[#a855f7] hover:underline"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
