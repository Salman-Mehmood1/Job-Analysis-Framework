import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { STAFF, requireRole } from '../auth';
import type { DB } from '../db';
import { HttpError, body, idParam, me } from '../http';
import { loadStructures, resolveStructure } from '../structures';

const roleEnum = z.enum(['admin', 'evaluator', 'management', 'respondent']);

/** Users, companies, departments and positions of the signed-in user's organisation. */
export function orgRoutes(db: DB) {
  const r = Router();
  const admin = requireRole('admin');
  const anyone = requireRole(...STAFF);

  const owned = (table: string, id: number, orgId: number) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`).get(id, orgId);
    if (!row) throw new HttpError(404, 'Not found');
    return row as Record<string, unknown>;
  };

  // ------------------------------------------------------------ organisation
  r.patch('/organization', admin, (req, res) => {
    const b = body(req, z.object({ name: z.string().trim().min(2).max(120), currencyNote: z.string().max(300) }));
    db.prepare('UPDATE organizations SET name = ?, currency_note = ? WHERE id = ?').run(b.name, b.currencyNote, me(req).orgId);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------- users
  r.get('/users', requireRole('admin', 'management'), (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at AS createdAt,
          (SELECT COUNT(*) FROM evaluations e WHERE e.evaluator_id = u.id) AS assigned,
          (SELECT COUNT(*) FROM evaluations e WHERE e.evaluator_id = u.id AND e.status IN ('submitted','approved')) AS completed
         FROM users u WHERE u.org_id = ? ORDER BY u.role, u.name`,
      )
      .all(me(req).orgId);
    res.json(rows);
  });

  r.post('/users', admin, (req, res) => {
    const b = body(
      req,
      z.object({
        name: z.string().trim().min(2).max(120),
        email: z.email(),
        role: roleEnum,
        password: z.string().min(8).max(200),
      }),
    );
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw new HttpError(409, 'Email already in use');
    const info = db
      .prepare('INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(me(req).orgId, b.name, b.email, bcrypt.hashSync(b.password, 10), b.role);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/users/:id', admin, (req, res) => {
    const id = idParam(req);
    owned('users', id, me(req).orgId);
    const b = body(
      req,
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        role: roleEnum.optional(),
        active: z.boolean().optional(),
        password: z.string().min(8).max(200).optional(),
      }),
    );
    if (id === me(req).id && (b.active === false || (b.role && b.role !== 'admin'))) {
      throw new HttpError(400, 'You cannot deactivate or demote your own account');
    }
    if (b.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name, id);
    if (b.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, id);
    if (b.active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
    if (b.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(b.password, 10), id);
    res.json({ ok: true });
  });

  // --------------------------------------------------------------- companies
  r.get('/companies', anyone, (req, res) => {
    res.json(db.prepare('SELECT id, name, default_structure_id AS defaultStructureId FROM companies WHERE org_id = ? ORDER BY name').all(me(req).orgId));
  });

  r.post('/companies', admin, (req, res) => {
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120) }));
    try {
      const info = db.prepare('INSERT INTO companies (org_id, name) VALUES (?, ?)').run(me(req).orgId, b.name);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      throw new HttpError(409, 'A company with this name already exists');
    }
  });

  r.patch('/companies/:id', admin, (req, res) => {
    const id = idParam(req);
    owned('companies', id, me(req).orgId);
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120) }));
    db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(b.name, id);
    res.json({ ok: true });
  });

  r.delete('/companies/:id', admin, (req, res) => {
    const id = idParam(req);
    owned('companies', id, me(req).orgId);
    if (db.prepare('SELECT 1 FROM positions WHERE company_id = ?').get(id)) {
      throw new HttpError(409, 'Remove or move this company’s positions first');
    }
    db.prepare('DELETE FROM companies WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- departments
  r.get('/departments', anyone, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT d.id, d.name, d.company_id AS companyId, c.name AS companyName
           FROM departments d JOIN companies c ON c.id = d.company_id
           WHERE d.org_id = ? ORDER BY c.name, d.name`,
        )
        .all(me(req).orgId),
    );
  });

  r.post('/departments', admin, (req, res) => {
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120), companyId: z.number().int() }));
    owned('companies', b.companyId, me(req).orgId);
    try {
      const info = db
        .prepare('INSERT INTO departments (org_id, company_id, name) VALUES (?, ?, ?)')
        .run(me(req).orgId, b.companyId, b.name);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      throw new HttpError(409, 'This company already has a department with that name');
    }
  });

  r.patch('/departments/:id', admin, (req, res) => {
    const id = idParam(req);
    owned('departments', id, me(req).orgId);
    const b = body(req, z.object({ name: z.string().trim().min(1).max(120) }));
    db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(b.name, id);
    res.json({ ok: true });
  });

  r.delete('/departments/:id', admin, (req, res) => {
    const id = idParam(req);
    owned('departments', id, me(req).orgId);
    if (db.prepare('SELECT 1 FROM positions WHERE department_id = ?').get(id)) {
      throw new HttpError(409, 'Remove or move this department’s positions first');
    }
    db.prepare('DELETE FROM departments WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // --------------------------------------------------------------- positions
  const positionSchema = z.object({
    code: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(160),
    jobFamily: z.string().trim().max(120).default(''),
    jobDescription: z.string().max(50_000).default(''),
    companyId: z.number().int(),
    departmentId: z.number().int(),
    /** null = automatic (company default, else organisation default); absent = unchanged on edit. */
    gradeStructureId: z.number().int().nullable().optional(),
  });

  const checkStructure = (orgId: number, id: number | null | undefined) => {
    if (id && !db.prepare('SELECT 1 FROM grade_structures WHERE id = ? AND org_id = ?').get(id, orgId)) {
      throw new HttpError(400, 'Unknown grade structure');
    }
  };

  const checkDept = (orgId: number, companyId: number, departmentId: number) => {
    owned('companies', companyId, orgId);
    const d = owned('departments', departmentId, orgId);
    if (d.company_id !== companyId) throw new HttpError(400, 'Department does not belong to that company');
  };

  r.get('/positions', requireRole('admin', 'management'), (req, res) => {
    const structures = loadStructures(db, me(req).orgId);
    res.json(
      db
        .prepare(
          `SELECT p.id, p.code, p.title, p.job_family AS jobFamily, p.job_description AS jobDescription,
                  p.company_id AS companyId, c.name AS companyName, p.department_id AS departmentId, d.name AS departmentName,
                  p.grade_structure_id AS gradeStructureId,
                  (SELECT COUNT(*) FROM evaluations e WHERE e.position_id = p.id) AS evaluations
           FROM positions p JOIN companies c ON c.id = p.company_id JOIN departments d ON d.id = p.department_id
           WHERE p.org_id = ? ORDER BY p.code`,
        )
        .all(me(req).orgId)
        .map((p) => {
          const row = p as { gradeStructureId: number | null; companyId: number };
          const { structure, source } = resolveStructure(structures, row.gradeStructureId, row.companyId);
          return { ...row, gradeStructure: { id: structure.id, name: structure.name, source } };
        }),
    );
  });

  const insertPosition = (orgId: number, p: z.infer<typeof positionSchema>) => {
    checkDept(orgId, p.companyId, p.departmentId);
    checkStructure(orgId, p.gradeStructureId);
    try {
      return Number(
        db
          .prepare(
            'INSERT INTO positions (org_id, company_id, department_id, code, title, job_family, job_description, grade_structure_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(orgId, p.companyId, p.departmentId, p.code, p.title, p.jobFamily, p.jobDescription, p.gradeStructureId ?? null).lastInsertRowid,
      );
    } catch {
      throw new HttpError(409, `Position code ${p.code} already exists`);
    }
  };

  r.post('/positions', requireRole('admin', 'management'), (req, res) => {
    const b = body(req, positionSchema);
    res.status(201).json({ id: insertPosition(me(req).orgId, b) });
  });

  /**
   * Bulk import rows of {code, title, company, department, jobFamily, jobDescription, gradeStructure}.
   * Companies and departments are created on the fly; gradeStructure must name an existing
   * structure (blank = automatic).
   */
  r.post('/positions/import', admin, (req, res) => {
    const rows = body(
      req,
      z.array(
        z.object({
          code: z.string().trim().min(1).max(40),
          title: z.string().trim().min(1).max(160),
          company: z.string().trim().min(1).max(120),
          department: z.string().trim().min(1).max(120),
          jobFamily: z.string().trim().max(120).default(''),
          jobDescription: z.string().max(50_000).default(''),
          gradeStructure: z.string().trim().max(80).default(''),
        }),
      ).max(2000),
    );
    const orgId = me(req).orgId;
    const structureIds = new Map(
      (db.prepare('SELECT id, name FROM grade_structures WHERE org_id = ?').all(orgId) as { id: number; name: string }[]).map((x) => [x.name.toLowerCase(), x.id]),
    );
    const unknown = [...new Set(rows.map((r) => r.gradeStructure).filter((n) => n && !structureIds.has(n.toLowerCase())))];
    if (unknown.length) throw new HttpError(400, `Unknown grade structure: ${unknown.join(', ')}. Create it first or leave the column blank.`);
    const result = db.transaction(() => {
      let created = 0;
      const skipped: string[] = [];
      for (const row of rows) {
        let c = db.prepare('SELECT id FROM companies WHERE org_id = ? AND name = ?').get(orgId, row.company) as { id: number } | undefined;
        if (!c) c = { id: Number(db.prepare('INSERT INTO companies (org_id, name) VALUES (?, ?)').run(orgId, row.company).lastInsertRowid) };
        let d = db.prepare('SELECT id FROM departments WHERE company_id = ? AND name = ?').get(c.id, row.department) as { id: number } | undefined;
        if (!d) d = { id: Number(db.prepare('INSERT INTO departments (org_id, company_id, name) VALUES (?, ?, ?)').run(orgId, c.id, row.department).lastInsertRowid) };
        if (db.prepare('SELECT 1 FROM positions WHERE org_id = ? AND code = ?').get(orgId, row.code)) {
          skipped.push(row.code);
          continue;
        }
        db.prepare(
          'INSERT INTO positions (org_id, company_id, department_id, code, title, job_family, job_description, grade_structure_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(orgId, c.id, d.id, row.code, row.title, row.jobFamily, row.jobDescription, row.gradeStructure ? structureIds.get(row.gradeStructure.toLowerCase())! : null);
        created++;
      }
      return { created, skipped };
    })();
    res.json(result);
  });

  r.patch('/positions/:id', admin, (req, res) => {
    const id = idParam(req);
    const orgId = me(req).orgId;
    owned('positions', id, orgId);
    const b = body(req, positionSchema);
    checkDept(orgId, b.companyId, b.departmentId);
    checkStructure(orgId, b.gradeStructureId);
    try {
      db.prepare(
        'UPDATE positions SET code = ?, title = ?, job_family = ?, job_description = ?, company_id = ?, department_id = ? WHERE id = ?',
      ).run(b.code, b.title, b.jobFamily, b.jobDescription, b.companyId, b.departmentId, id);
      if (b.gradeStructureId !== undefined) db.prepare('UPDATE positions SET grade_structure_id = ? WHERE id = ?').run(b.gradeStructureId, id);
    } catch {
      throw new HttpError(409, `Position code ${b.code} already exists`);
    }
    res.json({ ok: true });
  });

  r.delete('/positions/:id', admin, (req, res) => {
    const id = idParam(req);
    owned('positions', id, me(req).orgId);
    db.prepare('DELETE FROM positions WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  return r;
}

