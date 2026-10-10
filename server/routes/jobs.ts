import { Router } from 'express';
import { z } from 'zod';
import { inputsComplete } from '../../shared/engine';
import { inputsSchema } from '../../shared/schemas';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { getJob, isComplete, listJobs } from '../jobs';
import { logHistory } from '../services';

/**
 * Job-level results and calibration of jobs with several evaluators.
 * Admin can read; only management can change a calibration.
 */
export function jobRoutes(db: DB) {
  const r = Router();
  const readers = requireRole('admin', 'management');
  const mgmt = requireRole('management');

  r.get('/', readers, (req, res) => {
    // The list view doesn't need the per-element consensus breakdown.
    res.json(listJobs(db, me(req).orgId).map(({ consensus: _c, ...j }) => j));
  });

  r.get('/:positionId', readers, (req, res) => {
    const job = getJob(db, me(req).orgId, idParam(req, 'positionId'));
    if (!job) throw new HttpError(404, 'Job not found');
    res.json(job);
  });

  const multiJob = (req: Parameters<typeof me>[0]) => {
    const u = me(req);
    const job = getJob(db, u.orgId, idParam(req, 'positionId'));
    if (!job) throw new HttpError(404, 'Job not found');
    if (job.mode !== 'multi') throw new HttpError(409, 'Calibration applies to jobs with more than one evaluator');
    return { u, job };
  };

  const upsert = (orgId: number, positionId: number) => {
    db.prepare('INSERT INTO calibrations (org_id, position_id) VALUES (?, ?) ON CONFLICT(position_id) DO NOTHING').run(orgId, positionId);
  };

  // Save management's adjusted consensus (inputs: null reverts to the computed consensus).
  r.put('/:positionId/calibration', mgmt, (req, res) => {
    const { u, job } = multiJob(req);
    if (job.calibration?.status === 'approved') throw new HttpError(409, 'Reopen the calibration before changing it');
    const b = body(req, z.object({ inputs: inputsSchema.nullable(), comment: z.string().max(5000).default('') }));
    if (b.inputs && !inputsComplete(b.inputs)) throw new HttpError(400, 'Set every element');
    upsert(u.orgId, job.id);
    db.prepare(
      "UPDATE calibrations SET adjusted_inputs = ?, comment = ?, updated_by = ?, updated_at = datetime('now') WHERE position_id = ?",
    ).run(b.inputs ? JSON.stringify(b.inputs) : null, b.comment, u.id, job.id);
    res.json(getJob(db, u.orgId, job.id));
  });

  // Approve: freeze the agreed levels and mark the included evaluations approved.
  r.post('/:positionId/calibration/approve', mgmt, (req, res) => {
    const { u, job } = multiJob(req);
    if (job.calibration?.status === 'approved') throw new HttpError(409, 'Already approved');
    const b = body(req, z.object({ comment: z.string().max(5000).optional() }));
    const included = job.evaluations.filter(isComplete);
    if (included.length < 2) throw new HttpError(400, 'At least two submitted evaluations are needed to calibrate');
    const final = job.calibration?.adjustedInputs ?? job.consensus?.inputs;
    if (!final || !inputsComplete(final)) throw new HttpError(400, 'The agreed levels are incomplete');

    db.transaction(() => {
      upsert(u.orgId, job.id);
      db.prepare(
        `UPDATE calibrations SET status = 'approved', final_inputs = ?, included_ids = ?, comment = COALESCE(?, comment),
           approved_by = ?, approved_at = datetime('now'), updated_by = ?, updated_at = datetime('now') WHERE position_id = ?`,
      ).run(JSON.stringify(final), JSON.stringify(included.map((e) => e.id)), b.comment ?? null, u.id, u.id, job.id);
      for (const e of included) {
        db.prepare(
          "UPDATE evaluations SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        ).run(e.id);
        logHistory(db, e.id, u.id, 'calibrated', { evaluators: included.length });
      }
    })();
    res.json(getJob(db, u.orgId, job.id));
  });

  r.post('/:positionId/calibration/reopen', mgmt, (req, res) => {
    const { u, job } = multiJob(req);
    if (job.calibration?.status !== 'approved') throw new HttpError(409, 'The calibration is not approved');
    db.transaction(() => {
      db.prepare(
        "UPDATE calibrations SET status = 'open', final_inputs = NULL, approved_by = NULL, approved_at = NULL, updated_by = ?, updated_at = datetime('now') WHERE position_id = ?",
      ).run(u.id, job.id);
      for (const id of job.calibration!.includedIds) {
        const info = db
          .prepare("UPDATE evaluations SET status = 'submitted', approved_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'approved'")
          .run(id);
        if (info.changes) logHistory(db, id, u.id, 'calibration_reopened');
      }
    })();
    res.json(getJob(db, u.orgId, job.id));
  });

  return r;
}
