/**
 * Questionnaire pack on the server: job holder / line manager responses and
 * the evaluator's questionnaire, consolidated into the evaluation's levels.
 */
import {
  type Answers,
  EMPTY_EV_QUESTIONNAIRE,
  type EvaluatorQuestionnaire,
  type JobInfo,
  consolidate,
} from '../shared/questionnaire';
import type { DB } from './db';

export interface ResponseRow {
  id: number;
  position_id: number;
  user_id: number;
  user_name: string;
  role: 'JH' | 'LM';
  status: 'invited' | 'in_progress' | 'submitted';
  answers: string;
  job_info: string;
  complex_problem: string;
  due_date: string | null;
  submitted_at: string | null;
  updated_at: string;
}

export function listResponses(db: DB, orgId: number, positionId: number): ResponseRow[] {
  return db
    .prepare(
      `SELECT r.*, u.name AS user_name FROM questionnaire_responses r JOIN users u ON u.id = r.user_id
       WHERE r.org_id = ? AND r.position_id = ? ORDER BY r.role DESC, r.id`,
    )
    .all(orgId, positionId) as ResponseRow[];
}

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function parseEvQuestionnaire(s: string | null): EvaluatorQuestionnaire {
  const q = json<Partial<EvaluatorQuestionnaire>>(s, {});
  return {
    answers: q.answers ?? {},
    magnitude: { ...EMPTY_EV_QUESTIONNAIRE.magnitude, ...(q.magnitude ?? {}) },
    overrides: q.overrides ?? {},
  };
}

/** Only submitted responses count towards consolidation. */
export function submittedAnswers(rows: ResponseRow[]) {
  const done = rows.filter((r) => r.status === 'submitted');
  return {
    jh: done.filter((r) => r.role === 'JH').map((r) => json<Answers>(r.answers, {})),
    lm: done.filter((r) => r.role === 'LM').map((r) => json<Answers>(r.answers, {})),
  };
}

/** Everything the evaluator (and admin / management) see for an evaluation's questionnaire. */
export function questionnaireView(db: DB, orgId: number, positionId: number, evaluationQuestionnaire: string | null) {
  const rows = listResponses(db, orgId, positionId);
  const ev = parseEvQuestionnaire(evaluationQuestionnaire);
  const { jh, lm } = submittedAnswers(rows);
  return {
    ev,
    result: consolidate(ev, jh, lm),
    respondents: rows.map((r) => ({
      id: r.id,
      role: r.role,
      name: r.user_name,
      status: r.status,
      dueDate: r.due_date,
      submittedAt: r.submitted_at,
      // Answers count only once submitted; drafts stay private to the respondent.
      answers: r.status === 'submitted' ? json<Answers>(r.answers, {}) : null,
      jobInfo: r.status === 'submitted' ? json<JobInfo>(r.job_info, {}) : null,
      complexProblem: r.status === 'submitted' ? r.complex_problem : null,
    })),
  };
}

/** Recompute stored levels for every still-editable questionnaire evaluation of a job. */
export function refreshQuestionnaireEvaluations(db: DB, orgId: number, positionId: number) {
  const evals = db
    .prepare(
      `SELECT id, questionnaire FROM evaluations
       WHERE org_id = ? AND position_id = ? AND method = 'questionnaire' AND status IN ('assigned','in_progress','returned')`,
    )
    .all(orgId, positionId) as { id: number; questionnaire: string | null }[];
  if (!evals.length) return;
  const { jh, lm } = submittedAnswers(listResponses(db, orgId, positionId));
  for (const e of evals) {
    const r = consolidate(parseEvQuestionnaire(e.questionnaire), jh, lm);
    db.prepare("UPDATE evaluations SET inputs = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(r.inputs), e.id);
  }
}
