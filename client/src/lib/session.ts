import { useSyncExternalStore } from 'react';
import type { User } from './types';

// The token lives in localStorage, which any script on the page can read.
// See the README for why and what to change before launch.
const listeners = new Set<() => void>();

function read(): User | null {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

let current = read();

function emit() {
  current = read();
  listeners.forEach((l) => l());
}

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function saveSession(token: string, user: User) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  emit();
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  emit();
}

window.addEventListener('storage', emit); // logout in another tab

export function useUser(): User | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
}
