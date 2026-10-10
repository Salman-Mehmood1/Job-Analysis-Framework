/**
 * Job-level view: one record per position, combining its evaluations.
 *
 * - One evaluation: the job's result is that evaluation's result (as before).
 * - Several evaluations: the result is the consensus of the submitted ones,
 *   or management's adjusted consensus, or (once approved) the frozen
 *   calibrated levels.
 */
import { type Consensus, buildConsensus } from '../shared/consensus';
import { type EvaluationInputs, type EvaluationResult, type GradeBand, evaluate } from '../shared/engine';
import type { DB } from './db';
import { type EnrichedEvaluation, getGrades, listEvaluations, parseInputs } from './services';

export interface CalibrationRow {
  id: number;
  position_id: number;
  status: 'open' | 'approved';
  adjusted_inputs: string | null;
  comment: string;
  final_inputs: string | null;
  included_ids: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
}

export type JobStatus = 'assigned' | 'in_progress' | 'submitted' | 'returned' | 'approved';
export type ResultBasis = 'evaluation' | 'consensus' | 'adjusted_consensus' | 'calibrated';

const DONE = ['submitted', 'approved'];

export function isComplete(e: EnrichedEvaluation) {
  return DONE.includes(e.status) && !!e.inputs && !!e.originalResult?.complete;
}

function loadCalibrations(db: DB, orgId: number, positionId?: number) {
  const rows = db
    .prepare(
      `SELECT c.*, ub.name AS updated_by_name, ab.name AS approved_by_name
       FROM calibrations c LEFT JOIN users ub ON ub.id = c.updated_by LEFT JOIN users ab ON ab.id = c.approved_by
       WHERE c.org_id = ? ${positionId ? 'AND c.position_id = ?' : ''}`,
    )
    .all(...(positionId ? [orgId, positionId] : [orgId])) as CalibrationRow[];
  return new Map(rows.map((r) => [r.position_id, r]));
}

function buildJob(evals: EnrichedEvaluation[], cal: CalibrationRow | undefined, grades: GradeBand[]) {
  const first = evals[0];
  const multi = evals.length > 1;
  const complete = evals.filter(isComplete);
  const evaluators = evals.map((e) => ({ id: e.evaluator?.id ?? null, name: e.evaluator?.name ?? 'JD analysis' }));

  let status: JobStatus;
  let result: EvaluationResult | null;
  let basis: ResultBasis;
  let consensus: Consensus | null = null;
  let effectiveInputs: EvaluationInputs | null;

  if (!multi) {
    status = first.status as JobStatus;
    result = first.result;
    basis = 'evaluation';
    effectiveInputs = first.adjustedInputs ?? first.inputs;
  } else {
    consensus = buildConsensus(complete.map((e) => e.inputs!));
    const finalInputs = cal?.status === 'approved' ? parseInputs(cal.final_inputs) : null;
    const adjusted = cal ? parseInputs(cal.adjusted_inputs) : null;
    effectiveInputs = finalInputs ?? adjusted ?? consensus?.inputs ?? null;
    basis = finalInputs ? 'calibrated' : adjusted ? 'adjusted_consensus' : 'consensus';
    result = effectiveInputs ? evaluate(effectiveInputs, grades) : null;
    if (cal?.status === 'approved') status = 'approved';
    else if (complete.length >= 2) status = 'submitted';
    else if (evals.some((e) => e.status !== 'assigned')) status = 'in_progress';
    else status = 'assigned';
  }

  const totals = complete.map((e) => e.originalResult!.totalPoints!);
  const gradeList = complete.map((e) => e.originalResult!.grade ?? 0);
  return {
    id: first.position.id,
    position: first.position,
    company: first.company,
    department: first.department,
    mode: multi ? ('multi' as const) : ('single' as const),
    evaluationId: multi ? null : first.id,
    evaluators,
    evaluationCount: evals.length,
    completeCount: complete.length,
    status,
    basis,
    result,
    effectiveInputs,
    /** Management changed the levels (single-evaluation adjustment or adjusted consensus). */
    adjusted: multi ? !!cal?.adjusted_inputs : !!first.adjustedInputs,
    spread: complete.length > 1
      ? { minPoints: Math.min(...totals), maxPoints: Math.max(...totals), minGrade: Math.min(...gradeList), maxGrade: Math.max(...gradeList) }
      : null,
    consensus,
    calibration: cal
      ? {
          status: cal.status,
          adjustedInputs: parseInputs(cal.adjusted_inputs),
          finalInputs: parseInputs(cal.final_inputs),
          includedIds: cal.included_ids ? (JSON.parse(cal.included_ids) as number[]) : [],
          comment: cal.comment,
          updatedAt: cal.updated_at,
          updatedBy: cal.updated_by_name,
          approvedAt: cal.approved_at,
          approvedBy: cal.approved_by_name,
        }
      : null,
  };
}

export type JobRecord = ReturnType<typeof buildJob>;

/** Every position that has at least one evaluation. */
export function listJobs(db: DB, orgId: number): JobRecord[] {
  const grades = getGrades(db, orgId);
  const cals = loadCalibrations(db, orgId);
  const byPos = new Map<number, EnrichedEvaluation[]>();
  for (const e of listEvaluations(db, orgId).reverse()) {
    byPos.set(e.position.id, [...(byPos.get(e.position.id) ?? []), e]);
  }
  return [...byPos.values()]
    .map((evals) => buildJob(evals, cals.get(evals[0].position.id), grades))
    .sort((a, b) => a.position.code.localeCompare(b.position.code));
}

export function getJob(db: DB, orgId: number, positionId: number) {
  const evals = listEvaluations(db, orgId)
    .filter((e) => e.position.id === positionId)
    .reverse();
  if (!evals.length) return null;
  const job = buildJob(evals, loadCalibrations(db, orgId, positionId).get(positionId), getGrades(db, orgId));
  return { ...job, evaluations: evals };
}

/** True when the evaluation's job has more than one evaluator (calibrated at job level). */
export function isMultiRater(db: DB, positionId: number) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM evaluations WHERE position_id = ?').get(positionId) as { n: number };
  return n > 1;
}

/**
 * The approved calibrated result of a job, as shown to its evaluators.
 * Only the agreed outcome is shared: never the other evaluations or how many there were.
 */
export function approvedCalibration(db: DB, orgId: number, positionId: number) {
  const row = db
    .prepare(
      `SELECT final_inputs, comment, approved_at FROM calibrations
       WHERE org_id = ? AND position_id = ? AND status = 'approved'`,
    )
    .get(orgId, positionId) as { final_inputs: string; comment: string; approved_at: string } | undefined;
  const inputs = row ? parseInputs(row.final_inputs) : null;
  if (!row || !inputs) return null;
  return { inputs, result: evaluate(inputs, getGrades(db, orgId)), comment: row.comment, approvedAt: row.approved_at };
}
