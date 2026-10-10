import { Router } from 'express';
import { z } from 'zod';
import { inputsComplete } from '../../shared/engine';
import { inputsSchema } from '../../shared/schemas';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { getEvaluation, getHistory, listEvaluations, logHistory } from '../services';

/**
 * Evaluation workflow:
 *   assigned → in_progress → submitted → approved
 *                  ↑             │
 *                  └── returned ←┘   (management sends back with a comment)
 * Management may adjust levels on submitted or approved evaluations; the
 * evaluator's original levels are kept alongside the adjustment.
 */
export function evaluationRoutes(db: DB) {
  const r = Router();
  const admin = requireRole('admin');
  const mgmt = requireRole('management');

  const load = (orgId: number, id: number) => {
    const e = getEvaluation(db, orgId, id);
    if (!e) throw new HttpError(404, 'Evaluation not found');
    return e;
  };

  r.get('/', requireRole(), (req, res) => {
    const u = me(req);
    res.json(listEvaluations(db, u.orgId, u.role === 'evaluator' ? u.id : undefined));
  });

  r.get('/:id', requireRole(), (req, res) => {
    const u = me(req);
    const e = load(u.orgId, idParam(req));
    if (u.role === 'evaluator' && e.evaluator?.id !== u.id) throw new HttpError(404, 'Evaluation not found');
    res.json({ ...e, history: getHistory(db, e.id) });
  });

  // Assign one or more positions to an evaluator.
  r.post('/', admin, (req, res) => {
    const u = me(req);
    const b = body(
      req,
      z.object({
        positionIds: z.array(z.number().int()).min(1).max(500),
        evaluatorId: z.number().int(),
        dueDate: z.string().max(20).nullable().optional(),
        instructions: z.string().max(5000).default(''),
      }),
    );
    const ev = db.prepare("SELECT id FROM users WHERE id = ? AND org_id = ? AND role = 'evaluator' AND active = 1").get(b.evaluatorId, u.orgId);
    if (!ev) throw new HttpError(400, 'Choose an active evaluator from your organisation');
    const ids = db.transaction(() =>
      b.positionIds.map((pid) => {
        if (!db.prepare('SELECT 1 FROM positions WHERE id = ? AND org_id = ?').get(pid, u.orgId)) {
          throw new HttpError(400, `Unknown position ${pid}`);
        }
        const id = Number(
          db
            .prepare(
              'INSERT INTO evaluations (org_id, position_id, evaluator_id, assigned_by, due_date, instructions) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(u.orgId, pid, b.evaluatorId, u.id, b.dueDate ?? null, b.instructions).lastInsertRowid,
        );
        logHistory(db, id, u.id, 'assigned', { evaluatorId: b.evaluatorId });
        return id;
      }),
    )();
    res.status(201).json({ ids });
  });

  r.patch('/:id/assignment', admin, (req, res) => {
    const u = me(req);
    const e = load(u.orgId, idParam(req));
    const b = body(
      req,
      z.object({
        evaluatorId: z.number().int().optional(),
        dueDate: z.string().max(20).nullable().optional(),
        instructions: z.string().max(5000).optional(),
      }),
    );
    if (b.evaluatorId !== undefined) {
      const ok = db.prepare("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND role = 'evaluator' AND active = 1").get(b.evaluatorId, u.orgId);
      if (!ok) throw new HttpError(400, 'Choose an active evaluator from your organisation');
      db.prepare("UPDATE evaluations SET evaluator_id = ?, updated_at = datetime('now') WHERE id = ?").run(b.evaluatorId, e.id);
      logHistory(db, e.id, u.id, 'reassigned', { from: e.evaluator?.name, toId: b.evaluatorId });
    }
    if (b.dueDate !== undefined) db.prepare('UPDATE evaluations SET due_date = ? WHERE id = ?').run(b.dueDate, e.id);
    if (b.instructions !== undefined) db.prepare('UPDATE evaluations SET instructions = ? WHERE id = ?').run(b.instructions, e.id);
    res.json(load(u.orgId, e.id));
  });

  r.delete('/:id', admin, (req, res) => {
    const u = me(req);
    const e = load(u.orgId, idParam(req));
    db.prepare('DELETE FROM evaluations WHERE id = ?').run(e.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- evaluator
  const ownEditable = (req: Parameters<typeof me>[0]) => {
    const u = me(req);
    const e = load(u.orgId, idParam(req));
    if (e.evaluator?.id !== u.id) throw new HttpError(404, 'Evaluation not found');
    if (!['assigned', 'in_progress', 'returned'].includes(e.status)) {
      throw new HttpError(409, 'This evaluation has been submitted and can no longer be edited');
    }
    return { u, e };
  };

  r.put('/:id/inputs', requireRole('evaluator'), (req, res) => {
    const { u, e } = ownEditable(req);
    const b = body(
      req,
      z.object({
        inputs: inputsSchema,
        rationale: z.string().max(20_000).default(''),
        source: z.enum(['manual', 'jd_analysis']).default('manual'),
      }),
    );
    const status = e.status === 'assigned' ? 'in_progress' : e.status;
    db.prepare(
      "UPDATE evaluations SET inputs = ?, rationale = ?, source = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(b.inputs), b.rationale, b.source, status, e.id);
    if (e.status === 'assigned') logHistory(db, e.id, u.id, 'started');
    res.json(load(u.orgId, e.id));
  });

  r.post('/:id/submit', requireRole('evaluator'), (req, res) => {
    const { u, e } = ownEditable(req);
    if (!e.inputs || !inputsComplete(e.inputs)) throw new HttpError(400, 'Complete every element before submitting');
    db.prepare(
      "UPDATE evaluations SET status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ).run(e.id);
    logHistory(db, e.id, u.id, 'submitted', { totalPoints: e.result?.totalPoints, grade: e.result?.grade });
    res.json(load(u.orgId, e.id));
  });

  // ------------------------------------------------------------ management
  const reviewable = (req: Parameters<typeof me>[0]) => {
    const u = me(req);
    const e = load(u.orgId, idParam(req));
    if (!['submitted', 'approved'].includes(e.status)) {
      throw new HttpError(409, 'Only submitted or approved evaluations can be reviewed');
    }
    return { u, e };
  };

  r.put('/:id/adjust', mgmt, (req, res) => {
    const { u, e } = reviewable(req);
    const b = body(req, z.object({ inputs: inputsSchema, comment: z.string().max(5000).default('') }));
    if (!inputsComplete(b.inputs)) throw new HttpError(400, 'An adjustment must set every element');
    db.prepare(
      "UPDATE evaluations SET adjusted_inputs = ?, adjusted_by = ?, adjusted_at = datetime('now'), review_comment = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(b.inputs), u.id, b.comment, e.id);
    const after = load(u.orgId, e.id);
    logHistory(db, e.id, u.id, 'adjusted', {
      fromPoints: e.result?.totalPoints,
      toPoints: after.result?.totalPoints,
      fromGrade: e.result?.grade,
      toGrade: after.result?.grade,
      comment: b.comment,
    });
    res.json(after);
  });

  r.delete('/:id/adjust', mgmt, (req, res) => {
    const { u, e } = reviewable(req);
    db.prepare(
      "UPDATE evaluations SET adjusted_inputs = NULL, adjusted_by = NULL, adjusted_at = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(e.id);
    logHistory(db, e.id, u.id, 'adjustment_cleared');
    res.json(load(u.orgId, e.id));
  });

  r.post('/:id/approve', mgmt, (req, res) => {
    const { u, e } = reviewable(req);
    const b = body(req, z.object({ comment: z.string().max(5000).optional() }));
    db.prepare(
      "UPDATE evaluations SET status = 'approved', approved_at = datetime('now'), review_comment = COALESCE(?, review_comment), updated_at = datetime('now') WHERE id = ?",
    ).run(b.comment ?? null, e.id);
    logHistory(db, e.id, u.id, 'approved', { totalPoints: e.result?.totalPoints, grade: e.result?.grade });
    res.json(load(u.orgId, e.id));
  });

  r.post('/:id/return', mgmt, (req, res) => {
    const { u, e } = reviewable(req);
    const b = body(req, z.object({ comment: z.string().trim().min(1, 'Say what the evaluator should change').max(5000) }));
    db.prepare(
      "UPDATE evaluations SET status = 'returned', approved_at = NULL, review_comment = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(b.comment, e.id);
    logHistory(db, e.id, u.id, 'returned', { comment: b.comment });
    res.json(load(u.orgId, e.id));
  });

  r.post('/approve-bulk', mgmt, (req, res) => {
    const u = me(req);
    const b = body(req, z.object({ ids: z.array(z.number().int()).min(1).max(2000) }));
    const n = db.transaction(() => {
      let count = 0;
      for (const id of b.ids) {
        const info = db
          .prepare(
            "UPDATE evaluations SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND org_id = ? AND status = 'submitted'",
          )
          .run(id, u.orgId);
        if (info.changes) {
          logHistory(db, id, u.id, 'approved');
          count++;
        }
      }
      return count;
    })();
    res.json({ approved: n });
  });

  return r;
}
