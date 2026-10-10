import {
  EMPTY_INPUTS,
  type EvaluationInputs,
  type GradeBand,
  evaluate,
  sortGrades,
} from '../shared/engine';
import type { DB } from './db';

export function getGrades(db: DB, orgId: number): GradeBand[] {
  const rows = db
    .prepare(
      'SELECT grade, min_points AS minPoints, career_level AS careerLevel, typical_roles AS typicalRoles FROM grades WHERE org_id = ? ORDER BY min_points',
    )
    .all(orgId) as GradeBand[];
  return sortGrades(rows);
}

export function parseInputs(json: string | null): EvaluationInputs | null {
  if (!json) return null;
  try {
    return { ...EMPTY_INPUTS, ...JSON.parse(json) };
  } catch {
    return null;
  }
}

interface EvalRow {
  id: number;
  position_id: number;
  position_code: string;
  position_title: string;
  job_family: string;
  job_description: string;
  company_id: number;
  company_name: string;
  department_id: number;
  department_name: string;
  evaluator_id: number | null;
  evaluator_name: string | null;
  assigned_by_name: string | null;
  adjusted_by_name: string | null;
  status: string;
  due_date: string | null;
  instructions: string;
  inputs: string | null;
  rationale: string;
  source: string;
  adjusted_inputs: string | null;
  adjusted_at: string | null;
  review_comment: string;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

const BASE_SELECT = `
SELECT e.id, e.position_id, p.code AS position_code, p.title AS position_title, p.job_family,
       p.job_description, p.company_id, c.name AS company_name, p.department_id, d.name AS department_name,
       e.evaluator_id, u.name AS evaluator_name, ab.name AS assigned_by_name, adj.name AS adjusted_by_name,
       e.status, e.due_date, e.instructions, e.inputs, e.rationale, e.source, e.adjusted_inputs,
       e.adjusted_at, e.review_comment, e.submitted_at, e.approved_at, e.created_at, e.updated_at
FROM evaluations e
JOIN positions p ON p.id = e.position_id
JOIN companies c ON c.id = p.company_id
JOIN departments d ON d.id = p.department_id
LEFT JOIN users u ON u.id = e.evaluator_id
LEFT JOIN users ab ON ab.id = e.assigned_by
LEFT JOIN users adj ON adj.id = e.adjusted_by
`;

function enrich(row: EvalRow, grades: GradeBand[]) {
  const inputs = parseInputs(row.inputs);
  const adjusted = parseInputs(row.adjusted_inputs);
  const effective = adjusted ?? inputs;
  return {
    id: row.id,
    position: {
      id: row.position_id,
      code: row.position_code,
      title: row.position_title,
      jobFamily: row.job_family,
      jobDescription: row.job_description,
    },
    company: { id: row.company_id, name: row.company_name },
    department: { id: row.department_id, name: row.department_name },
    evaluator: row.evaluator_id ? { id: row.evaluator_id, name: row.evaluator_name } : null,
    assignedBy: row.assigned_by_name,
    status: row.status,
    dueDate: row.due_date,
    instructions: row.instructions,
    inputs,
    rationale: row.rationale,
    source: row.source,
    adjustedInputs: adjusted,
    adjustedBy: row.adjusted_by_name,
    adjustedAt: row.adjusted_at,
    reviewComment: row.review_comment,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    /** Evaluator's own score. */
    originalResult: inputs ? evaluate(inputs, grades) : null,
    /** Score after any management adjustment; this is what grading uses. */
    result: effective ? evaluate(effective, grades) : null,
  };
}

export type EnrichedEvaluation = ReturnType<typeof enrich>;

export function listEvaluations(db: DB, orgId: number, evaluatorId?: number): EnrichedEvaluation[] {
  const grades = getGrades(db, orgId);
  const rows = (
    evaluatorId
      ? db.prepare(`${BASE_SELECT} WHERE e.org_id = ? AND e.evaluator_id = ? ORDER BY e.id DESC`).all(orgId, evaluatorId)
      : db.prepare(`${BASE_SELECT} WHERE e.org_id = ? ORDER BY e.id DESC`).all(orgId)
  ) as EvalRow[];
  return rows.map((r) => enrich(r, grades));
}

export function getEvaluation(db: DB, orgId: number, id: number): EnrichedEvaluation | null {
  const row = db.prepare(`${BASE_SELECT} WHERE e.org_id = ? AND e.id = ?`).get(orgId, id) as EvalRow | undefined;
  return row ? enrich(row, getGrades(db, orgId)) : null;
}

export function logHistory(db: DB, evaluationId: number, userId: number, action: string, details: object = {}) {
  db.prepare('INSERT INTO evaluation_history (evaluation_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
    evaluationId,
    userId,
    action,
    JSON.stringify(details),
  );
}

export function getHistory(db: DB, evaluationId: number) {
  return (
    db
      .prepare(
        `SELECT h.id, h.action, h.details, h.at, u.name AS user_name, u.role AS user_role
         FROM evaluation_history h LEFT JOIN users u ON u.id = h.user_id
         WHERE h.evaluation_id = ? ORDER BY h.id`,
      )
      .all(evaluationId) as { id: number; action: string; details: string; at: string; user_name: string; user_role: string }[]
  ).map((h) => ({ ...h, details: JSON.parse(h.details) }));
}
