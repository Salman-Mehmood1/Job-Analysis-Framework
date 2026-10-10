import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { type AuthUser, COOKIE, type Role, issueSession, requireRole } from '../auth';
import { type DB, seedDefaultGrades } from '../db';
import { HttpError, body, me } from '../http';

export function authRoutes(db: DB) {
  const r = Router();

  const toAuthUser = (u: { id: number; org_id: number; role: Role; name: string; email: string }): AuthUser => ({
    id: u.id,
    orgId: u.org_id,
    role: u.role,
    name: u.name,
    email: u.email,
  });

  // Creates a new organisation with its first administrator.
  r.post('/register', (req, res) => {
    const b = body(
      req,
      z.object({
        organization: z.string().trim().min(2).max(120),
        name: z.string().trim().min(2).max(120),
        email: z.email(),
        password: z.string().min(8).max(200),
      }),
    );
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    const user = db.transaction(() => {
      const orgId = Number(db.prepare('INSERT INTO organizations (name) VALUES (?)').run(b.organization).lastInsertRowid);
      seedDefaultGrades(db, orgId);
      const id = Number(
        db
          .prepare("INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')")
          .run(orgId, b.name, b.email, bcrypt.hashSync(b.password, 10)).lastInsertRowid,
      );
      return { id, org_id: orgId, role: 'admin' as Role, name: b.name, email: b.email };
    })();
    const au = toAuthUser(user);
    issueSession(res, au);
    res.status(201).json({ user: au, organization: { id: au.orgId, name: b.organization } });
  });

  r.post('/login', (req, res) => {
    const b = body(req, z.object({ email: z.string().trim(), password: z.string() }));
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email) as
      | { id: number; org_id: number; role: Role; name: string; email: string; password_hash: string; active: number }
      | undefined;
    if (!u || !bcrypt.compareSync(b.password, u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
    if (!u.active) throw new HttpError(403, 'This account has been deactivated');
    const au = toAuthUser(u);
    issueSession(res, au);
    const org = db.prepare('SELECT id, name, currency_note AS currencyNote FROM organizations WHERE id = ?').get(u.org_id);
    res.json({ user: au, organization: org });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  r.get('/me', requireRole(), (req, res) => {
    const u = me(req);
    const org = db.prepare('SELECT id, name, currency_note AS currencyNote FROM organizations WHERE id = ?').get(u.orgId);
    res.json({ user: u, organization: org });
  });

  r.post('/password', requireRole(), (req, res) => {
    const b = body(req, z.object({ current: z.string(), next: z.string().min(8).max(200) }));
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me(req).id) as { password_hash: string };
    if (!bcrypt.compareSync(b.current, u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(b.next, 10), me(req).id);
    res.json({ ok: true });
  });

  return r;
}
