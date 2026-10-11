import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GRADES, type GradeBand } from '../shared/engine';
import type { PayModel } from '../shared/pay';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  currency_note TEXT NOT NULL DEFAULT 'Magnitude bands are in USD (annual value).',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','evaluator','management','respondent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  job_family TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL,
  min_points INTEGER NOT NULL,
  career_level TEXT NOT NULL DEFAULT '',
  typical_roles TEXT NOT NULL DEFAULT '',
  UNIQUE (org_id, grade)
);

-- inputs = evaluator's levels; adjusted_inputs = management's override (null if none).
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  evaluator_id INTEGER REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','in_progress','submitted','returned','approved')),
  due_date TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  inputs TEXT,
  rationale TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','jd_analysis')),
  adjusted_inputs TEXT,
  adjusted_by INTEGER REFERENCES users(id),
  adjusted_at TEXT,
  review_comment TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluation_history (
  id INTEGER PRIMARY KEY,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jd_analyses (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  jd_text TEXT NOT NULL,
  method TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One per job (position) that has several evaluators.
-- adjusted_inputs: management's edits to the consensus (null = use the computed consensus).
-- final_inputs / included_ids: snapshot taken when the calibration is approved.
CREATE TABLE IF NOT EXISTS calibrations (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved')),
  adjusted_inputs TEXT,
  comment TEXT NOT NULL DEFAULT '',
  final_inputs TEXT,
  included_ids TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT
);

-- Named grade structures (e.g. "Blue collar", "Managers", one per company).
-- A position's structure: its own grade_structure_id, else its company's
-- default_structure_id, else the organisation's default (is_default = 1).
CREATE TABLE IF NOT EXISTS grade_structures (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS grade_bands (
  id INTEGER PRIMARY KEY,
  structure_id INTEGER NOT NULL REFERENCES grade_structures(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL,
  min_points INTEGER NOT NULL,
  career_level TEXT NOT NULL DEFAULT '',
  typical_roles TEXT NOT NULL DEFAULT '',
  UNIQUE (structure_id, grade)
);

-- Questionnaire pack: a job holder (JH) or line manager (LM) asked to answer the
-- questionnaire for a job. Job holders are optional.
CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('JH','LM')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','in_progress','submitted')),
  answers TEXT NOT NULL DEFAULT '{}',
  job_info TEXT NOT NULL DEFAULT '{}',
  complex_problem TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  invited_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  UNIQUE (position_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_eval_org ON evaluations(org_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluator ON evaluations(evaluator_id);
CREATE INDEX IF NOT EXISTS idx_pos_org ON positions(org_id);
`;

export function openDb(file = process.env.DB_FILE ?? path.resolve('data/job-evaluation.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function addColumn(db: DB, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

/** Upgrades databases created before grade structures existed. Safe to run on every start. */
function migrate(db: DB) {
  // Older databases only allowed admin/evaluator/management; rebuild users to allow respondents.
  const usersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string }).sql;
  if (!usersSql.includes("'respondent'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','evaluator','management','respondent')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, org_id, name, email, password_hash, role, active, created_at)
        SELECT id, org_id, name, email, password_hash, role, active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;`);
      const bad = db.pragma('foreign_key_check') as unknown[];
      if (bad.length) throw new Error('Foreign key check failed while upgrading users');
    })();
    db.pragma('foreign_keys = ON');
  }
  addColumn(db, 'evaluations', 'method', "TEXT NOT NULL DEFAULT 'direct'");
  addColumn(db, 'evaluations', 'questionnaire', 'TEXT');
  addColumn(db, 'positions', 'grade_structure_id', 'INTEGER REFERENCES grade_structures(id) ON DELETE SET NULL');
  addColumn(db, 'companies', 'default_structure_id', 'INTEGER REFERENCES grade_structures(id) ON DELETE SET NULL');
  addColumn(db, 'jd_analyses', 'structure_id', 'INTEGER REFERENCES grade_structures(id) ON DELETE SET NULL');
  // Salary bands, cadres and pay inputs of a structure (JSON PayModel); null = points-only structure.
  addColumn(db, 'grade_structures', 'pay', 'TEXT');
  // Each organisation's original single grade table becomes its default "Standard" structure.
  const orgs = db
    .prepare('SELECT id FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM grade_structures s WHERE s.org_id = o.id)')
    .all() as { id: number }[];
  for (const { id } of orgs) {
    db.transaction(() => {
      const legacy = db
        .prepare('SELECT grade, min_points AS minPoints, career_level AS careerLevel, typical_roles AS typicalRoles FROM grades WHERE org_id = ? ORDER BY min_points')
        .all(id) as GradeBand[];
      createStructure(db, id, 'Standard', 'The organisation-wide grade structure.', legacy.length ? legacy : DEFAULT_GRADES, true);
    })();
  }
}

export function createStructure(
  db: DB,
  orgId: number,
  name: string,
  description: string,
  bands: GradeBand[],
  isDefault = false,
  pay: PayModel | null = null,
): number {
  const id = Number(
    db
      .prepare('INSERT INTO grade_structures (org_id, name, description, is_default, pay) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, name, description, isDefault ? 1 : 0, pay ? JSON.stringify(pay) : null).lastInsertRowid,
  );
  replaceBands(db, id, bands);
  return id;
}

export function replaceBands(db: DB, structureId: number, bands: GradeBand[]) {
  db.prepare('DELETE FROM grade_bands WHERE structure_id = ?').run(structureId);
  const ins = db.prepare(
    'INSERT INTO grade_bands (structure_id, grade, min_points, career_level, typical_roles) VALUES (?, ?, ?, ?, ?)',
  );
  for (const g of bands) ins.run(structureId, g.grade, g.minPoints, g.careerLevel, g.typicalRoles);
}

/** A new organisation starts with the workbook's 23 grades as its default structure. */
export function seedDefaultGrades(db: DB, orgId: number) {
  return createStructure(db, orgId, 'Standard', 'The organisation-wide grade structure.', DEFAULT_GRADES, true);
}
