import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastState = { type: 'success' | 'error' | 'info'; message: string } | null;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((type: NonNullable<ToastState>['type'], message: string) => {
    clearTimeout(timer.current);
    setToast({ type, message });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show };
}

const styles = {
  success: 'bg-gradient-to-r from-[#22c55e] to-[#16a34a]',
  error: 'bg-gradient-to-r from-[#ef4444] to-[#dc2626]',
  info: 'bg-gradient-to-r from-[#f59e0b] to-[#d97706]',
};

export default function Toast({ toast }: { toast: ToastState }) {
  return (
    <div aria-live="polite" className="fixed top-24 right-4 left-4 sm:left-auto z-50">
      {toast && (
        <div role="status" className={`px-6 py-4 rounded-2xl shadow-2xl font-medium sm:max-w-sm ${styles[toast.type]}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
