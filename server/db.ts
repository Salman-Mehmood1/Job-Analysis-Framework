import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GRADES } from '../shared/engine';

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
  role TEXT NOT NULL CHECK (role IN ('admin','evaluator','management')),
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
  return db;
}

export function seedDefaultGrades(db: DB, orgId: number) {
  const ins = db.prepare(
    'INSERT INTO grades (org_id, grade, min_points, career_level, typical_roles) VALUES (?, ?, ?, ?, ?)',
  );
  for (const g of DEFAULT_GRADES) ins.run(orgId, g.grade, g.minPoints, g.careerLevel, g.typicalRoles);
}
