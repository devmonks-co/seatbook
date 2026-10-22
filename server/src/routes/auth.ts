import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../db';
import { asyncHandler, HttpError, isUniqueViolation } from '../lib/errors';
import { signToken } from '../middleware/auth';

const router = Router();

const BCRYPT_ROUNDS = 12;
// Compared against when the email doesn't exist so both paths take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

// In-memory per-IP counters: fine for one server process. With several
// instances this needs a shared store (e.g. Redis), see the README.
function limiter(opts: { windowMinutes: number; limit: number; skipSuccessfulRequests: boolean }) {
  return rateLimit({
    windowMs: opts.windowMinutes * 60 * 1000,
    limit: opts.limit,
    skipSuccessfulRequests: opts.skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' });
    },
  });
}

// Failed logins per IP (brute force). Successful ones don't count.
const loginLimiter = limiter({ windowMinutes: 15, limit: 20, skipSuccessfulRequests: true });
// Every signup counts, to slow down mass account creation (and mass seat holding).
const registerLimiter = limiter({ windowMinutes: 60, limit: 20, skipSuccessfulRequests: false });

const email = z.string().trim().toLowerCase().email('must be a valid email address').max(254);

const registerSchema = z.object({
  email,
  // bcrypt only looks at the first 72 bytes
  password: z.string().min(8, 'must be at least 8 characters').max(72, 'must be at most 72 characters'),
  name: z.string().trim().min(1, 'is required').max(100),
  role: z.enum(['ORGANIZER', 'ATTENDEE']).default('ATTENDEE'),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'is required').max(200),
});

function publicUser(user: { id: number; email: string; name: string; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body ?? {});
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    let user;
    try {
      user = await prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash, role: input.role },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
      throw err;
    }

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body ?? {});

    // Older accounts may have been stored with mixed-case emails.
    const user = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } } });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new HttpError(401, 'Incorrect email or password', 'INVALID_CREDENTIALS');
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

export default router;
