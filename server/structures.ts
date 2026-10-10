/**
 * Grade structures: loading them and deciding which one grades a position.
 *
 * A position uses, in order of precedence:
 *   1. the structure assigned to the position itself,
 *   2. its company's default structure,
 *   3. the organisation's default structure.
 */
import { type GradeBand, sortGrades } from '../shared/engine';
import type { DB } from './db';

export interface Structure {
  id: number;
  name: string;
  description: string;
  isDefault: boolean;
  bands: GradeBand[];
}

export type StructureSource = 'position' | 'company' | 'organisation';

export interface StructureContext {
  byId: Map<number, Structure>;
  defaultId: number;
  companyDefaults: Map<number, number>;
}

export function loadStructures(db: DB, orgId: number): StructureContext {
  const rows = db
    .prepare('SELECT id, name, description, is_default FROM grade_structures WHERE org_id = ? ORDER BY is_default DESC, name')
    .all(orgId) as { id: number; name: string; description: string; is_default: number }[];
  const bands = db
    .prepare(
      `SELECT b.structure_id, b.grade, b.min_points AS minPoints, b.career_level AS careerLevel, b.typical_roles AS typicalRoles
       FROM grade_bands b JOIN grade_structures s ON s.id = b.structure_id WHERE s.org_id = ?`,
    )
    .all(orgId) as (GradeBand & { structure_id: number })[];
  const byId = new Map<number, Structure>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      description: r.description,
      isDefault: !!r.is_default,
      bands: sortGrades(bands.filter((b) => b.structure_id === r.id).map(({ structure_id: _s, ...g }) => g)),
    });
  }
  const defaultId = rows.find((r) => r.is_default)?.id ?? rows[0]?.id;
  if (defaultId === undefined) throw new Error(`Organisation ${orgId} has no grade structure`);
  const companyDefaults = new Map(
    (
      db.prepare('SELECT id, default_structure_id FROM companies WHERE org_id = ? AND default_structure_id IS NOT NULL').all(orgId) as {
        id: number;
        default_structure_id: number;
      }[]
    ).map((c) => [c.id, c.default_structure_id]),
  );
  return { byId, defaultId, companyDefaults };
}

export function resolveStructure(
  ctx: StructureContext,
  positionStructureId: number | null | undefined,
  companyId: number | null | undefined,
): { structure: Structure; source: StructureSource } {
  if (positionStructureId && ctx.byId.has(positionStructureId)) {
    return { structure: ctx.byId.get(positionStructureId)!, source: 'position' };
  }
  const companyDefault = companyId ? ctx.companyDefaults.get(companyId) : undefined;
  if (companyDefault && ctx.byId.has(companyDefault)) {
    return { structure: ctx.byId.get(companyDefault)!, source: 'company' };
  }
  return { structure: ctx.byId.get(ctx.defaultId)!, source: 'organisation' };
}

/** The structure grading one position. */
export function structureForPosition(db: DB, orgId: number, positionId: number) {
  const p = db.prepare('SELECT grade_structure_id, company_id FROM positions WHERE id = ? AND org_id = ?').get(positionId, orgId) as
    | { grade_structure_id: number | null; company_id: number }
    | undefined;
  const ctx = loadStructures(db, orgId);
  return p ? resolveStructure(ctx, p.grade_structure_id, p.company_id) : { structure: ctx.byId.get(ctx.defaultId)!, source: 'organisation' as const };
}
