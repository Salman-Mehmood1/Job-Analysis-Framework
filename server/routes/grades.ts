import { Router } from 'express';
import { DEFAULT_GRADES } from '../../shared/engine';
import { gradeStructureSchema } from '../../shared/schemas';
import { requireRole } from '../auth';
import type { DB } from '../db';
import { body, me } from '../http';
import { getGrades } from '../services';

export function gradeRoutes(db: DB) {
  const r = Router();
  const editors = requireRole('admin', 'management');

  r.get('/', requireRole(), (req, res) => {
    res.json({ grades: getGrades(db, me(req).orgId), defaults: DEFAULT_GRADES });
  });

  // Replaces the whole grade structure. Grades are re-derived for every
  // evaluation on read, so the change applies everywhere immediately.
  r.put('/', editors, (req, res) => {
    const grades = body(req, gradeStructureSchema);
    const orgId = me(req).orgId;
    db.transaction(() => {
      db.prepare('DELETE FROM grades WHERE org_id = ?').run(orgId);
      const ins = db.prepare(
        'INSERT INTO grades (org_id, grade, min_points, career_level, typical_roles) VALUES (?, ?, ?, ?, ?)',
      );
      for (const g of grades) ins.run(orgId, g.grade, g.minPoints, g.careerLevel, g.typicalRoles);
    })();
    res.json({ grades: getGrades(db, orgId) });
  });

  return r;
}
