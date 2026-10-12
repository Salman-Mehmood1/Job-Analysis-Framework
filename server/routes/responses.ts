import { Router } from 'express';
import { z } from 'zod';
import { JOB_INFO_FIELDS, cleanAnswers } from '../../shared/questionnaire';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { invitePeople, loadPositionPeople } from '../people';
import { refreshQuestionnaireEvaluations } from '../questionnaire';

/**
 * Questionnaire responses from job holders (JH, optional) and line managers (LM).
 * Respondents see only their own requests and never another respondent's ratings.
 */
export function responseRoutes(db: DB) {
  const r = Router();
  // Anyone signed in can answer the questionnaires they were asked to (staff can be line managers too).
  const respondent = requireRole();
  const admin = requireRole('admin');

  const jobInfoSchema = z.object(Object.fromEntries(JOB_INFO_FIELDS.map((f) => [f.key, z.string().max(5000).optional()]))).partial();

  type Row = {
    id: number;
    org_id: number;
    position_id: number;
    user_id: number;
    role: 'JH' | 'LM';
    status: string;
    answers: string;
    job_info: string;
    complex_problem: string;
    due_date: string | null;
    submitted_at: string | null;
    updated_at: string;
  };

  const own = (req: Parameters<typeof me>[0]) => {
    const u = me(req);
    const row = db.prepare('SELECT * FROM questionnaire_responses WHERE id = ? AND user_id = ? AND org_id = ?').get(idParam(req), u.id, u.orgId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Questionnaire not found');
    return { u, row };
  };

  const positionInfo = (positionId: number) =>
    db
      .prepare(
        `SELECT p.id, p.code, p.title, p.job_description AS jobDescription, c.name AS companyName, d.name AS departmentName
         FROM positions p JOIN companies c ON c.id = p.company_id JOIN departments d ON d.id = p.department_id WHERE p.id = ?`,
      )
      .get(positionId);

  const view = (row: Row) => ({
    id: row.id,
    role: row.role,
    status: row.status,
    dueDate: row.due_date,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    answers: JSON.parse(row.answers),
    jobInfo: JSON.parse(row.job_info),
    complexProblem: row.complex_problem,
    position: positionInfo(row.position_id),
  });

  // ------------------------------------------------------------ respondent
  r.get('/mine', respondent, (req, res) => {
    const u = me(req);
    const rows = db.prepare('SELECT * FROM questionnaire_responses WHERE user_id = ? AND org_id = ? ORDER BY id DESC').all(u.id, u.orgId) as Row[];
    res.json(rows.map((row) => ({ ...view(row), answers: undefined, jobInfo: undefined, answered: Object.keys(JSON.parse(row.answers)).length })));
  });

  r.get('/mine/:id', respondent, (req, res) => {
    const { row } = own(req);
    // The line manager checks the job holder's job information (Part 2), but never sees their ratings.
    const jhJobInfo =
      row.role === 'LM'
        ? (db
            .prepare("SELECT u.name, r.job_info AS jobInfo, r.complex_problem AS complexProblem FROM questionnaire_responses r JOIN users u ON u.id = r.user_id WHERE r.position_id = ? AND r.role = 'JH' AND r.status = 'submitted'")
            .all(row.position_id) as { name: string; jobInfo: string; complexProblem: string }[]
          ).map((j) => ({ name: j.name, jobInfo: JSON.parse(j.jobInfo), complexProblem: j.complexProblem }))
        : [];
    res.json({ ...view(row), jobHolderInfo: jhJobInfo });
  });

  r.put('/mine/:id', respondent, (req, res) => {
    const { row } = own(req);
    if (row.status === 'submitted') throw new HttpError(409, 'This questionnaire has been submitted');
    const b = body(
      req,
      z.object({ answers: z.record(z.string(), z.number()).default({}), jobInfo: jobInfoSchema.default({}), complexProblem: z.string().max(10_000).default('') }),
    );
    db.prepare(
      "UPDATE questionnaire_responses SET answers = ?, job_info = ?, complex_problem = ?, status = 'in_progress', updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(cleanAnswers(b.answers, { respondent: true })), JSON.stringify(b.jobInfo), b.complexProblem, row.id);
    res.json(view(db.prepare('SELECT * FROM questionnaire_responses WHERE id = ?').get(row.id) as Row));
  });

  r.post('/mine/:id/submit', respondent, (req, res) => {
    const { u, row } = own(req);
    if (row.status === 'submitted') throw new HttpError(409, 'Already submitted');
    if (!Object.keys(JSON.parse(row.answers)).length) throw new HttpError(400, 'Answer at least one question before submitting');
    db.transaction(() => {
      db.prepare("UPDATE questionnaire_responses SET status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(row.id);
      refreshQuestionnaireEvaluations(db, u.orgId, row.position_id);
    })();
    res.json(view(db.prepare('SELECT * FROM questionnaire_responses WHERE id = ?').get(row.id) as Row));
  });

  // ----------------------------------------------------------------- admin
  r.get('/', requireRole('admin', 'management'), (req, res) => {
    const u = me(req);
    const positionId = Number(req.query.positionId);
    const rows = db
      .prepare(
        `SELECT r.id, r.position_id AS positionId, r.role, r.status, r.due_date AS dueDate, r.submitted_at AS submittedAt,
                u.id AS userId, u.name AS userName, p.code AS positionCode, p.title AS positionTitle
         FROM questionnaire_responses r JOIN users u ON u.id = r.user_id JOIN positions p ON p.id = r.position_id
         WHERE r.org_id = ? ${positionId ? 'AND r.position_id = ?' : ''} ORDER BY p.code, r.role DESC`,
      )
      .all(...(positionId ? [u.orgId, positionId] : [u.orgId]));
    res.json(rows);
  });

  const adminOwned = (req: Parameters<typeof me>[0]) => {
    const u = me(req);
    const row = db.prepare('SELECT * FROM questionnaire_responses WHERE id = ? AND org_id = ?').get(idParam(req), u.orgId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Not found');
    return { u, row };
  };

  /**
   * Every questionnaire request in the organisation, plus questionnaire jobs that have no line
   * manager asked yet (with the position's default line manager, if one is set).
   */
  r.get('/overview', requireRole('admin', 'management'), (req, res) => {
    const u = me(req);
    const requests = db
      .prepare(
        `SELECT r.id, r.position_id AS positionId, r.role, r.status, r.due_date AS dueDate, r.created_at AS invitedAt,
                r.updated_at AS updatedAt, r.submitted_at AS submittedAt,
                u.id AS userId, u.name AS userName, u.email AS userEmail, u.role AS userRole,
                p.code AS positionCode, p.title AS positionTitle, c.name AS companyName, d.name AS departmentName,
                (SELECT COUNT(*) FROM evaluations e WHERE e.position_id = r.position_id AND e.method = 'questionnaire') AS questionnaireEvaluations
         FROM questionnaire_responses r JOIN users u ON u.id = r.user_id JOIN positions p ON p.id = r.position_id
         JOIN companies c ON c.id = p.company_id JOIN departments d ON d.id = p.department_id
         WHERE r.org_id = ? ORDER BY p.code, r.role DESC, u.name`,
      )
      .all(u.orgId) as { answers?: string }[];
    const answered = new Map(
      (db.prepare('SELECT id, answers FROM questionnaire_responses WHERE org_id = ?').all(u.orgId) as { id: number; answers: string }[]).map((x) => [
        x.id,
        Object.keys(JSON.parse(x.answers)).length,
      ]),
    );
    const people = loadPositionPeople(db, u.orgId);
    const missing = (
      db
        .prepare(
          `SELECT p.id AS positionId, p.code AS positionCode, p.title AS positionTitle, c.name AS companyName, d.name AS departmentName,
                  COUNT(e.id) AS evaluations
           FROM positions p JOIN companies c ON c.id = p.company_id JOIN departments d ON d.id = p.department_id
           JOIN evaluations e ON e.position_id = p.id AND e.method = 'questionnaire' AND e.status IN ('assigned','in_progress','returned')
           WHERE p.org_id = ? AND NOT EXISTS (SELECT 1 FROM questionnaire_responses r WHERE r.position_id = p.id AND r.role = 'LM')
           GROUP BY p.id ORDER BY p.code`,
        )
        .all(u.orgId) as { positionId: number }[]
    ).map((m) => ({ ...m, defaultLineManager: people.get(m.positionId)?.lineManager ?? null }));
    res.json({ requests: requests.map((x) => ({ ...x, answered: answered.get((x as unknown as { id: number }).id) ?? 0 })), missing });
  });

  r.post('/', admin, (req, res) => {
    const u = me(req);
    const b = body(req, z.object({ positionId: z.number().int(), userId: z.number().int(), role: z.enum(['JH', 'LM']), dueDate: z.string().max(20).nullable().optional() }));
    if (!db.prepare('SELECT 1 FROM positions WHERE id = ? AND org_id = ?').get(b.positionId, u.orgId)) throw new HttpError(400, 'Unknown position');
    const { invited, skipped } = db.transaction(() => invitePeople(db, u.orgId, b.positionId, u.id, [{ userId: b.userId, role: b.role }], b.dueDate ?? null))();
    if (!invited.length) {
      const s = skipped[0];
      throw new HttpError(s.reason === 'has already been asked' ? 409 : 400, `${s.name} ${s.reason}`);
    }
    res.status(201).json({ id: invited[0] });
  });

  // Ask the position's default line manager and job holders (e.g. from the overview's "missing" list).
  r.post('/invite-defaults', admin, (req, res) => {
    const u = me(req);
    const b = body(req, z.object({ positionIds: z.array(z.number().int()).min(1).max(2000), dueDate: z.string().max(20).nullable().optional() }));
    const people = loadPositionPeople(db, u.orgId);
    const out = db.transaction(() => {
      let invited = 0;
      const skipped: unknown[] = [];
      const noDefaults: number[] = [];
      for (const pid of b.positionIds) {
        if (!db.prepare('SELECT 1 FROM positions WHERE id = ? AND org_id = ?').get(pid, u.orgId)) throw new HttpError(400, `Unknown position ${pid}`);
        const p = people.get(pid);
        if (!p?.lineManager && !p?.jobHolders.length) {
          noDefaults.push(pid);
          continue;
        }
        const list = [...(p.lineManager ? [{ userId: p.lineManager.id, role: 'LM' as const }] : []), ...p.jobHolders.map((j) => ({ userId: j.id, role: 'JH' as const }))];
        const r = invitePeople(db, u.orgId, pid, u.id, list, b.dueDate ?? null);
        invited += r.invited.length;
        skipped.push(...r.skipped);
      }
      return { invited, skipped, noDefaults };
    })();
    res.json(out);
  });

  r.patch('/:id', admin, (req, res) => {
    const { row } = adminOwned(req);
    const b = body(req, z.object({ dueDate: z.string().max(20).nullable() }));
    db.prepare("UPDATE questionnaire_responses SET due_date = ?, updated_at = datetime('now') WHERE id = ?").run(b.dueDate, row.id);
    res.json({ ok: true });
  });

  r.post('/:id/reopen', admin, (req, res) => {
    const { u, row } = adminOwned(req);
    db.transaction(() => {
      db.prepare("UPDATE questionnaire_responses SET status = 'in_progress', submitted_at = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
      refreshQuestionnaireEvaluations(db, u.orgId, row.position_id);
    })();
    res.json({ ok: true });
  });

  r.delete('/:id', admin, (req, res) => {
    const { u, row } = adminOwned(req);
    db.transaction(() => {
      db.prepare('DELETE FROM questionnaire_responses WHERE id = ?').run(row.id);
      refreshQuestionnaireEvaluations(db, u.orgId, row.position_id);
    })();
    res.json({ ok: true });
  });

  return r;
}
