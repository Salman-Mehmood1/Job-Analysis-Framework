import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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

let cachedSecret: string | null = null;

/**
 * Key that signs session cookies: JWT_SECRET if set, otherwise a random key
 * generated once and kept next to the database, so sign-ins survive restarts.
 */
function secret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;
  const dbFile = process.env.DB_FILE ?? path.resolve('data/job-evaluation.db');
  if (dbFile === ':memory:') return (cachedSecret = crypto.randomBytes(32).toString('hex'));
  const file = path.join(path.dirname(dbFile), '.session-secret');
  try {
    cachedSecret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    cachedSecret = '';
  }
  if (cachedSecret.length < 32) {
    cachedSecret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

export function issueSession(res: Response, user: AuthUser) {
  const token = jwt.sign(user, secret(), { expiresIn: '12h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Set COOKIE_SECURE=true when the app is served over HTTPS.
    secure: process.env.COOKIE_SECURE === 'true',
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
