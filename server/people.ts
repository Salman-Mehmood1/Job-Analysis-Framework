/**
 * Line managers and job holders of positions, and inviting them to a job's questionnaire.
 *
 * Any active user can be a line manager or job holder, including staff. To keep
 * evaluations independent, nobody can both evaluate a job and answer its questionnaire.
 */
import type { DB } from './db';

export type PersonRole = 'JH' | 'LM';
export const PERSON_ROLE_LABEL: Record<PersonRole, string> = { LM: 'line manager', JH: 'job holder' };

export interface PositionPeople {
  lineManager: { id: number; name: string } | null;
  jobHolders: { id: number; name: string }[];
}

/** Default line manager and job holders of every position in the organisation. */
export function loadPositionPeople(db: DB, orgId: number): Map<number, PositionPeople> {
  const rows = db
    .prepare(
      `SELECT pp.position_id, pp.role, u.id, u.name FROM position_people pp JOIN users u ON u.id = pp.user_id
       WHERE pp.org_id = ? ORDER BY u.name`,
    )
    .all(orgId) as { position_id: number; role: PersonRole; id: number; name: string }[];
  const out = new Map<number, PositionPeople>();
  for (const r of rows) {
    const p = out.get(r.position_id) ?? { lineManager: null, jobHolders: [] };
    if (r.role === 'LM') p.lineManager = { id: r.id, name: r.name };
    else p.jobHolders.push({ id: r.id, name: r.name });
    out.set(r.position_id, p);
  }
  return out;
}

export function peopleOf(db: DB, orgId: number, positionId: number): PositionPeople {
  return loadPositionPeople(db, orgId).get(positionId) ?? { lineManager: null, jobHolders: [] };
}

/** Replaces a position's default line manager and job holders. Callers check the users. */
export function setPositionPeople(db: DB, orgId: number, positionId: number, lineManagerId: number | null, jobHolderIds: number[]) {
  db.prepare('DELETE FROM position_people WHERE position_id = ?').run(positionId);
  const ins = db.prepare('INSERT OR IGNORE INTO position_people (org_id, position_id, user_id, role) VALUES (?, ?, ?, ?)');
  if (lineManagerId) ins.run(orgId, positionId, lineManagerId, 'LM');
  for (const id of new Set(jobHolderIds)) ins.run(orgId, positionId, id, 'JH');
}

export function activeUser(db: DB, orgId: number, userId: number) {
  return db.prepare('SELECT id, name, role FROM users WHERE id = ? AND org_id = ? AND active = 1').get(userId, orgId) as
    | { id: number; name: string; role: string }
    | undefined;
}

/** Why `userId` cannot answer the questionnaire of this job (they evaluate it), or null. */
export function respondentConflict(db: DB, positionId: number, userId: number): string | null {
  return db.prepare('SELECT 1 FROM evaluations WHERE position_id = ? AND evaluator_id = ?').get(positionId, userId)
    ? 'evaluates this job, so cannot also answer its questionnaire'
    : null;
}

/** Why `userId` cannot evaluate this job (they are, or are asked to be, its line manager or job holder), or null. */
export function evaluatorConflict(db: DB, positionId: number, userId: number): string | null {
  const asked = db.prepare('SELECT role FROM questionnaire_responses WHERE position_id = ? AND user_id = ?').get(positionId, userId) as { role: PersonRole } | undefined;
  const named = db.prepare('SELECT role FROM position_people WHERE position_id = ? AND user_id = ?').get(positionId, userId) as { role: PersonRole } | undefined;
  const role = asked?.role ?? named?.role;
  return role ? `is this job’s ${PERSON_ROLE_LABEL[role]}, so cannot also evaluate it` : null;
}

export interface InviteSkip {
  positionId: number;
  userId: number;
  role: PersonRole;
  name: string;
  reason: string;
}

/** Asks people to answer a job's questionnaire, skipping anyone already asked or with a conflict. */
export function invitePeople(
  db: DB,
  orgId: number,
  positionId: number,
  invitedBy: number,
  people: { userId: number; role: PersonRole }[],
  dueDate: string | null,
): { invited: number[]; skipped: InviteSkip[] } {
  const invited: number[] = [];
  const skipped: InviteSkip[] = [];
  for (const p of people) {
    const u = activeUser(db, orgId, p.userId);
    const skip = (reason: string) => skipped.push({ positionId, userId: p.userId, role: p.role, name: u?.name ?? `User ${p.userId}`, reason });
    if (!u) {
      skip('is not an active user');
      continue;
    }
    const conflict = respondentConflict(db, positionId, p.userId);
    if (conflict) {
      skip(conflict);
      continue;
    }
    if (db.prepare('SELECT 1 FROM questionnaire_responses WHERE position_id = ? AND user_id = ? AND role = ?').get(positionId, p.userId, p.role)) {
      skip('has already been asked');
      continue;
    }
    invited.push(
      Number(
        db
          .prepare('INSERT INTO questionnaire_responses (org_id, position_id, user_id, role, due_date, invited_by) VALUES (?, ?, ?, ?, ?, ?)')
          .run(orgId, positionId, p.userId, p.role, dueDate, invitedBy).lastInsertRowid,
      ),
    );
  }
  return { invited, skipped };
}
