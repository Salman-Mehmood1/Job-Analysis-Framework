import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export type Role = 'admin' | 'evaluator' | 'management' | 'respondent';

/** Roles that work on evaluations. Respondents (job holders / line managers) only see their own questionnaires. */
export const STAFF: Role[] = ['admin', 'evaluator', 'management'];

export interface AuthUser {
  id: number;
  orgId: number;
  role: Role;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = 'je_session';

function secret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  // Dev-only: random per process, so sessions reset on restart.
  return (globalThis as { __jeDevSecret?: string }).__jeDevSecret ??= crypto.randomBytes(32).toString('hex');
}

export function issueSession(res: Response, user: AuthUser) {
  const token = jwt.sign(user, secret(), { expiresIn: '12h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 3600 * 1000,
  });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const p = jwt.verify(token, secret()) as AuthUser;
      req.user = { id: p.id, orgId: p.orgId, role: p.role, name: p.name, email: p.email };
    } catch {
      /* invalid or expired: treated as signed out */
    }
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this action' });
    }
    next();
  };
}
