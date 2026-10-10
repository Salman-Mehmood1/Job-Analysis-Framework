import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_GRADES } from '../../shared/engine';
import { gradeStructureSchema } from '../../shared/schemas';
import { requireRole } from '../auth';
import { type DB, createStructure, replaceBands } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { loadStructures, resolveStructure } from '../structures';

/**
 * Named grade structures. Grades are derived on read, so any change here
 * re-grades every evaluation that uses the structure immediately.
 */
export function gradeRoutes(db: DB) {
  const r = Router();
  const editors = requireRole('admin', 'management');

  const owned = (orgId: number, id: number) => {
    const row = db.prepare('SELECT * FROM grade_structures WHERE id = ? AND org_id = ?').get(id, orgId) as
      | { id: number; is_default: number; name: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Grade structure not found');
    return row;
  };

  const usage = (orgId: number) => {
    const ctx = loadStructures(db, orgId);
    const positions = db.prepare('SELECT id, grade_structure_id, company_id FROM positions WHERE org_id = ?').all(orgId) as {
      id: number;
      grade_structure_id: number | null;
      company_id: number;
    }[];
    const counts = new Map<number, { positions: number; explicit: number }>();
    for (const p of positions) {
      const { structure, source } = resolveStructure(ctx, p.grade_structure_id, p.company_id);
      const c = counts.get(structure.id) ?? { positions: 0, explicit: 0 };
      c.positions++;
      if (source === 'position') c.explicit++;
      counts.set(structure.id, c);
    }
    return { ctx, counts };
  };

  r.get('/', requireRole(), (req, res) => {
    const orgId = me(req).orgId;
    const { ctx, counts } = usage(orgId);
    res.json({
      structures: [...ctx.byId.values()].map((s) => ({
        ...s,
        companyIds: [...ctx.companyDefaults.entries()].filter(([, sid]) => sid === s.id).map(([cid]) => cid),
        positionCount: counts.get(s.id)?.positions ?? 0,
        explicitCount: counts.get(s.id)?.explicit ?? 0,
      })),
      defaults: DEFAULT_GRADES,
    });
  });

  const nameSchema = z.string().trim().min(1).max(80);

  // Create from the 23 standard grades, a copy of another structure, or given bands.
  r.post('/', editors, (req, res) => {
    const orgId = me(req).orgId;
    const b = body(
      req,
      z.object({
        name: nameSchema,
        description: z.string().max(500).default(''),
        copyFrom: z.number().int().optional(),
        bands: gradeStructureSchema.optional(),
      }),
    );
    let bands = b.bands ?? DEFAULT_GRADES;
    if (b.copyFrom) {
      owned(orgId, b.copyFrom);
      bands = loadStructures(db, orgId).byId.get(b.copyFrom)!.bands;
    }
    if (db.prepare('SELECT 1 FROM grade_structures WHERE org_id = ? AND name = ?').get(orgId, b.name)) {
      throw new HttpError(409, 'A grade structure with this name already exists');
    }
    const id = db.transaction(() => createStructure(db, orgId, b.name, b.description, bands))();
    res.status(201).json({ id });
  });

  r.patch('/:id', editors, (req, res) => {
    const orgId = me(req).orgId;
    const s = owned(orgId, idParam(req));
    const b = body(req, z.object({ name: nameSchema.optional(), description: z.string().max(500).optional(), isDefault: z.literal(true).optional() }));
    db.transaction(() => {
      if (b.name && b.name !== s.name) {
        if (db.prepare('SELECT 1 FROM grade_structures WHERE org_id = ? AND name = ? AND id <> ?').get(orgId, b.name, s.id)) {
          throw new HttpError(409, 'A grade structure with this name already exists');
        }
        db.prepare('UPDATE grade_structures SET name = ? WHERE id = ?').run(b.name, s.id);
      }
      if (b.description !== undefined) db.prepare('UPDATE grade_structures SET description = ? WHERE id = ?').run(b.description, s.id);
      if (b.isDefault) {
        db.prepare('UPDATE grade_structures SET is_default = 0 WHERE org_id = ?').run(orgId);
        db.prepare('UPDATE grade_structures SET is_default = 1 WHERE id = ?').run(s.id);
      }
    })();
    res.json({ ok: true });
  });

  r.put('/:id/bands', editors, (req, res) => {
    const s = owned(me(req).orgId, idParam(req));
    const bands = body(req, gradeStructureSchema);
    db.transaction(() => replaceBands(db, s.id, bands))();
    res.json({ ok: true });
  });

  // Positions and companies that used it fall back to their company default or the organisation default.
  r.delete('/:id', editors, (req, res) => {
    const s = owned(me(req).orgId, idParam(req));
    if (s.is_default) throw new HttpError(409, 'Make another structure the organisation default before deleting this one');
    db.transaction(() => {
      db.prepare('UPDATE positions SET grade_structure_id = NULL WHERE grade_structure_id = ?').run(s.id);
      db.prepare('UPDATE companies SET default_structure_id = NULL WHERE default_structure_id = ?').run(s.id);
      db.prepare('DELETE FROM grade_structures WHERE id = ?').run(s.id);
    })();
    res.json({ ok: true });
  });

  // Make this the default structure for exactly these companies.
  r.put('/:id/companies', editors, (req, res) => {
    const orgId = me(req).orgId;
    const s = owned(orgId, idParam(req));
    const { companyIds } = body(req, z.object({ companyIds: z.array(z.number().int()).max(500) }));
    db.transaction(() => {
      db.prepare('UPDATE companies SET default_structure_id = NULL WHERE org_id = ? AND default_structure_id = ?').run(orgId, s.id);
      for (const cid of companyIds) {
        const info = db.prepare('UPDATE companies SET default_structure_id = ? WHERE id = ? AND org_id = ?').run(s.id, cid, orgId);
        if (!info.changes) throw new HttpError(400, `Unknown company ${cid}`);
      }
    })();
    res.json({ ok: true });
  });

  // Assign positions to a structure (structureId null = back to automatic: company or organisation default).
  r.post('/assign', editors, (req, res) => {
    const orgId = me(req).orgId;
    const b = body(req, z.object({ positionIds: z.array(z.number().int()).min(1).max(5000), structureId: z.number().int().nullable() }));
    if (b.structureId !== null) owned(orgId, b.structureId);
    const n = db.transaction(() => {
      let changed = 0;
      for (const pid of b.positionIds) {
        changed += db.prepare('UPDATE positions SET grade_structure_id = ? WHERE id = ? AND org_id = ?').run(b.structureId, pid, orgId).changes;
      }
      return changed;
    })();
    res.json({ updated: n });
  });

  return r;
}
