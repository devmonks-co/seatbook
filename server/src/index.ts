import { config } from './config';
import { createApp } from './app';
import prisma from './db';
import { expireStaleHolds } from './services/bookingService';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Seatbook API running on http://localhost:${config.port}`);
});

// Correctness doesn't depend on this: every read treats a hold past its
// expiresAt as free, and every write expires stale holds on the seat first.
// The sweep just keeps statuses in the table honest for reporting.
const sweep = setInterval(() => {
  expireStaleHolds().catch((err) => console.error('[holds] sweep failed', err));
}, 60_000);
sweep.unref();

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  clearInterval(sweep);
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
