import { Router } from 'express';
import { z } from 'zod';
import { JOB_INFO_FIELDS, cleanAnswers } from '../../shared/questionnaire';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { refreshQuestionnaireEvaluations } from '../questionnaire';

/**
 * Questionnaire responses from job holders (JH, optional) and line managers (LM).
 * Respondents see only their own requests and never another respondent's ratings.
 */
export function responseRoutes(db: DB) {
  const r = Router();
  const respondent = requireRole('respondent');
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

  r.post('/', admin, (req, res) => {
    const u = me(req);
    const b = body(req, z.object({ positionId: z.number().int(), userId: z.number().int(), role: z.enum(['JH', 'LM']), dueDate: z.string().max(20).nullable().optional() }));
    if (!db.prepare('SELECT 1 FROM positions WHERE id = ? AND org_id = ?').get(b.positionId, u.orgId)) throw new HttpError(400, 'Unknown position');
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role = 'respondent' AND active = 1").get(b.userId, u.orgId)) {
      throw new HttpError(400, 'Choose an active job holder / line manager user');
    }
    try {
      const id = Number(
        db
          .prepare('INSERT INTO questionnaire_responses (org_id, position_id, user_id, role, due_date, invited_by) VALUES (?, ?, ?, ?, ?, ?)')
          .run(u.orgId, b.positionId, b.userId, b.role, b.dueDate ?? null, u.id).lastInsertRowid,
      );
      res.status(201).json({ id });
    } catch {
      throw new HttpError(409, 'That person is already asked for this job in that role');
    }
  });

  const adminOwned = (req: Parameters<typeof me>[0]) => {
    const u = me(req);
    const row = db.prepare('SELECT * FROM questionnaire_responses WHERE id = ? AND org_id = ?').get(idParam(req), u.orgId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Not found');
    return { u, row };
  };

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
