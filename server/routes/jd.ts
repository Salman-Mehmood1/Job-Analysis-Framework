import express, { Router } from 'express';
import { z } from 'zod';
import { evaluate } from '../../shared/engine';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { MAX_UPLOAD_BYTES, extractJobDescription } from '../extract';
import { MODEL, aiEnabled, analyseJobDescription, type JdAnalysis } from '../jd';
import { logHistory } from '../services';
import { loadStructures, resolveStructure, structureForPosition } from '../structures';

export function jdRoutes(db: DB) {
  const r = Router();
  const anyone = requireRole();

  r.get('/status', anyone, (_req, res) => {
    res.json({ aiEnabled: aiEnabled(), model: aiEnabled() ? MODEL : null });
  });

  // Upload a Word, PDF or text file (raw bytes) and get its text back for review before analysis.
  r.post(
    '/extract',
    anyone,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }),
    async (req, res) => {
      const filename = String(req.query.filename ?? '').slice(0, 255);
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.json({ filename, ...(await extractJobDescription(buf, filename)) });
    },
  );

  r.post('/analyze', anyone, async (req, res) => {
    const u = me(req);
    const b = body(
      req,
      z.object({
        title: z.string().trim().max(160).default(''),
        text: z.string().trim().min(20, 'Paste a job description of at least a few sentences').max(50_000),
        positionId: z.number().int().nullable().optional(),
        method: z.enum(['auto', 'ai', 'rules']).default('auto'),
        /** Structure to grade a standalone analysis with; a linked position uses its own. */
        structureId: z.number().int().nullable().optional(),
      }),
    );
    if (b.structureId && !db.prepare('SELECT 1 FROM grade_structures WHERE id = ? AND org_id = ?').get(b.structureId, u.orgId)) {
      throw new HttpError(400, 'Unknown grade structure');
    }
    if (b.positionId) {
      if (!db.prepare('SELECT 1 FROM positions WHERE id = ? AND org_id = ?').get(b.positionId, u.orgId)) {
        throw new HttpError(400, 'Unknown position');
      }
      if (
        u.role === 'evaluator' &&
        !db.prepare('SELECT 1 FROM evaluations WHERE position_id = ? AND evaluator_id = ?').get(b.positionId, u.id)
      ) {
        throw new HttpError(403, 'You can only analyse positions assigned to you');
      }
    }
    const analysis = await analyseJobDescription(b.title, b.text, b.method);
    const structure = b.positionId
      ? structureForPosition(db, u.orgId, b.positionId).structure
      : resolveStructure(loadStructures(db, u.orgId), b.structureId, null).structure;
    const result = evaluate(analysis.inputs, structure.bands);
    const id = Number(
      db
        .prepare('INSERT INTO jd_analyses (org_id, user_id, position_id, title, jd_text, method, result, structure_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(u.orgId, u.id, b.positionId ?? null, b.title || analysis.suggested.title || 'Untitled job', b.text, analysis.method, JSON.stringify(analysis), b.positionId ? null : structure.id)
        .lastInsertRowid,
    );
    res.json({ id, analysis, result, gradeStructure: { id: structure.id, name: structure.name } });
  });

  r.get('/analyses', anyone, (req, res) => {
    const u = me(req);
    const ctx = loadStructures(db, u.orgId);
    const rows = db
      .prepare(
        `SELECT a.id, a.title, a.jd_text AS jdText, a.method, a.result, a.created_at AS createdAt, a.position_id AS positionId,
                u.name AS userName, u.role AS userRole, p.code AS positionCode,
                a.structure_id AS structureId, p.grade_structure_id AS positionStructureId, p.company_id AS companyId
         FROM jd_analyses a JOIN users u ON u.id = a.user_id LEFT JOIN positions p ON p.id = a.position_id
         WHERE a.org_id = ? ${u.role === 'evaluator' ? 'AND a.user_id = ?' : ''}
         ORDER BY a.id DESC LIMIT 500`,
      )
      .all(...(u.role === 'evaluator' ? [u.orgId, u.id] : [u.orgId])) as ({
        result: string;
        positionId: number | null;
        structureId: number | null;
        positionStructureId: number | null;
        companyId: number | null;
      } & Record<string, unknown>)[];
    res.json(
      rows.map(({ structureId, positionStructureId, companyId, ...row }) => {
        const analysis = JSON.parse(row.result) as JdAnalysis;
        // Linked to a position: grade like that position. Otherwise: the structure chosen when it ran.
        const { structure } = row.positionId
          ? resolveStructure(ctx, positionStructureId, companyId)
          : resolveStructure(ctx, structureId, null);
        return {
          ...row,
          result: undefined,
          analysis,
          score: evaluate(analysis.inputs, structure.bands),
          gradeStructure: { id: structure.id, name: structure.name },
        };
      }),
    );
  });

  /**
   * Turn an analysis into an independent evaluation (admin / management):
   * links to an existing position or creates one, and files the evaluation as
   * submitted so it flows into review and grading.
   */
  r.post('/analyses/:id/commit', requireRole('admin', 'management'), (req, res) => {
    const u = me(req);
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM jd_analyses WHERE id = ? AND org_id = ?').get(id, u.orgId) as
      | { result: string; jd_text: string; position_id: number | null }
      | undefined;
    if (!row) throw new HttpError(404, 'Analysis not found');
    const analysis = JSON.parse(row.result) as JdAnalysis;
    const b = body(
      req,
      z.union([
        z.object({ positionId: z.number().int() }),
        z.object({
          newPosition: z.object({
            code: z.string().trim().min(1).max(40),
            title: z.string().trim().min(1).max(160),
            jobFamily: z.string().trim().max(120).default(''),
            companyId: z.number().int(),
            departmentId: z.number().int(),
            /** null/absent = automatic (company default, else organisation default). */
            gradeStructureId: z.number().int().nullable().optional(),
          }),
        }),
      ]),
    );

    const evaluationId = db.transaction(() => {
      let positionId: number;
      if ('positionId' in b) {
        if (!db.prepare('SELECT 1 FROM positions WHERE id = ? AND org_id = ?').get(b.positionId, u.orgId)) {
          throw new HttpError(400, 'Unknown position');
        }
        positionId = b.positionId;
      } else {
        const p = b.newPosition;
        const dept = db.prepare('SELECT company_id FROM departments WHERE id = ? AND org_id = ?').get(p.departmentId, u.orgId) as
          | { company_id: number }
          | undefined;
        if (!dept || dept.company_id !== p.companyId) throw new HttpError(400, 'Choose a valid company and department');
        if (db.prepare('SELECT 1 FROM positions WHERE org_id = ? AND code = ?').get(u.orgId, p.code)) {
          throw new HttpError(409, `Position code ${p.code} already exists`);
        }
        if (p.gradeStructureId && !db.prepare('SELECT 1 FROM grade_structures WHERE id = ? AND org_id = ?').get(p.gradeStructureId, u.orgId)) {
          throw new HttpError(400, 'Unknown grade structure');
        }
        positionId = Number(
          db
            .prepare('INSERT INTO positions (org_id, company_id, department_id, code, title, job_family, job_description, grade_structure_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(u.orgId, p.companyId, p.departmentId, p.code, p.title, p.jobFamily, row.jd_text, p.gradeStructureId ?? null).lastInsertRowid,
        );
      }
      const rationale = Object.entries(analysis.rationale)
        .map(([k, v]) => `${k} ${v.level}: ${v.reason}`)
        .join('\n');
      const evId = Number(
        db
          .prepare(
            `INSERT INTO evaluations (org_id, position_id, evaluator_id, assigned_by, status, inputs, rationale, source, submitted_at)
             VALUES (?, ?, NULL, ?, 'submitted', ?, ?, 'jd_analysis', datetime('now'))`,
          )
          .run(u.orgId, positionId, u.id, JSON.stringify(analysis.inputs), `${analysis.summary}\n\n${rationale}`).lastInsertRowid,
      );
      db.prepare('UPDATE jd_analyses SET position_id = ? WHERE id = ?').run(positionId, id);
      logHistory(db, evId, u.id, 'created_from_jd_analysis', { analysisId: id, method: analysis.method });
      return evId;
    })();
    res.status(201).json({ evaluationId });
  });

  return r;
}
