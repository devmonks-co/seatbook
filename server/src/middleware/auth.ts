import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../db';
import { HttpError } from '../lib/errors';

export type Role = 'ORGANIZER' | 'ATTENDEE';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: { id: number }): string {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  return match ? match[1] : null;
}

// Role and email come from the database, not the token, so a deleted user or a
// role change takes effect immediately instead of when the token expires.
async function resolveUser(token: string): Promise<AuthUser | null> {
  let userId: number;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    userId = Number(payload.sub);
  } catch {
    return null;
  }
  if (!Number.isInteger(userId)) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next(new HttpError(401, 'Please log in', 'UNAUTHENTICATED'));

  resolveUser(token)
    .then((user) => {
      if (!user) return next(new HttpError(401, 'Your session has expired. Please log in again', 'UNAUTHENTICATED'));
      req.user = user;
      next();
    })
    .catch(next);
}

// For public endpoints that show extra detail to a logged-in user (e.g. "your hold").
// A bad or expired token is treated as anonymous rather than an error.
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next();
  resolveUser(token)
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(next);
}

export function requireRole(role: Role) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      const message = role === 'ORGANIZER' ? 'Only organizers can do this' : 'Only attendee accounts can book seats';
      return next(new HttpError(403, message, 'FORBIDDEN'));
    }
    next();
  };
}
