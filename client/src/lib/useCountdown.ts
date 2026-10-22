import { useEffect, useState } from 'react';

/**
 * Milliseconds left until `expiresAt`, ticking every second.
 * `clockOffsetMs` is server time minus device time, so a phone with a wrong
 * clock still shows the time the server will actually enforce.
 */
export function useCountdown(expiresAt: string | null | undefined, clockOffsetMs = 0): number | null {
  const compute = () => (expiresAt ? new Date(expiresAt).getTime() - (Date.now() + clockOffsetMs) : null);
  const [left, setLeft] = useState(compute);

  useEffect(() => {
    setLeft(compute());
    if (!expiresAt) return;
    const t = setInterval(() => setLeft(compute()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, clockOffsetMs]);

  return left;
}
