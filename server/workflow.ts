/**
 * Order-of-work rules shared by the routes: an action is refused while an earlier step it
 * depends on is still incomplete, and finished results are not changed behind people's backs.
 *
 *  Evaluator submits a questionnaire evaluation  ← every line manager / job holder asked has submitted
 *                                                   (and at least one line manager was asked)
 *  Management calibrates a multi-rater job       ← every evaluator of the job has submitted
 *  Respondents change (ask, reopen, remove)      ← no questionnaire evaluation of the job is submitted yet
 *  New evaluation / JD result for a job          ← the job's result is not approved
 *  Evaluation reassigned                         ← it is still open
 *  User deactivated or taken off evaluating      ← they have no open work
 */
import type { DB } from './db';

export const OPEN_STATUSES = ['assigned', 'in_progress', 'returned'] as const;
const OPEN_SQL = "('assigned','in_progress','returned')";

const names = (rows: { name: string }[]) => rows.map((r) => r.name).join(', ');

/** Why a questionnaire evaluation of this job cannot be submitted yet (empty = it can). */
export function questionnaireWaits(db: DB, positionId: number): string[] {
  const rows = db
    .prepare('SELECT r.role, r.status, u.name FROM questionnaire_responses r JOIN users u ON u.id = r.user_id WHERE r.position_id = ? ORDER BY u.name')
    .all(positionId) as { role: 'JH' | 'LM'; status: string; name: string }[];
  const out: string[] = [];
  const lms = rows.filter((r) => r.role === 'LM');
  const pendingLm = lms.filter((r) => r.status !== 'submitted');
  const pendingJh = rows.filter((r) => r.role === 'JH' && r.status !== 'submitted');
  if (!lms.length) out.push('No line manager has been asked to answer the questionnaire yet; the administrator needs to ask one.');
  if (pendingLm.length) out.push(`Waiting for the line manager (${names(pendingLm)}) to submit the questionnaire.`);
  if (pendingJh.length) {
    out.push(`Waiting for the job holder${pendingJh.length > 1 ? 's' : ''} (${names(pendingJh)}) to submit. Job holders are optional: the administrator can withdraw the request if they will not take part.`);
  }
  return out;
}

/** True once a questionnaire evaluation of the job is submitted: its respondents are then fixed. */
export function questionnaireLocked(db: DB, positionId: number): boolean {
  return !!db.prepare("SELECT 1 FROM evaluations WHERE position_id = ? AND method = 'questionnaire' AND status IN ('submitted','approved')").get(positionId);
}
export const LOCKED_MESSAGE =
  'A questionnaire evaluation of this job has already been submitted with the current answers. Management must return it to the evaluator before the respondents can change.';

/** The job's approved result, if any: an approved calibration, or its only evaluation approved. */
export function jobApproval(db: DB, positionId: number): 'calibration' | 'evaluation' | null {
  if (db.prepare("SELECT 1 FROM calibrations WHERE position_id = ? AND status = 'approved'").get(positionId)) return 'calibration';
  const evals = db.prepare('SELECT status FROM evaluations WHERE position_id = ?').all(positionId) as { status: string }[];
  return evals.length === 1 && evals[0].status === 'approved' ? 'evaluation' : null;
}
export function approvedMessage(kind: 'calibration' | 'evaluation') {
  return kind === 'calibration'
    ? 'the job’s calibration is approved; management must reopen it first'
    : 'the job’s evaluation is approved; management must return it for rework first';
}

/** Evaluators of the job who have not submitted yet. */
export function pendingEvaluators(db: DB, positionId: number): { name: string }[] {
  return db
    .prepare(`SELECT COALESCE(u.name, 'JD analysis') AS name FROM evaluations e LEFT JOIN users u ON u.id = e.evaluator_id WHERE e.position_id = ? AND e.status IN ${OPEN_SQL} ORDER BY u.name`)
    .all(positionId) as { name: string }[];
}
export function pendingEvaluatorsMessage(rows: { name: string }[]) {
  return `Waiting for ${names(rows)} to submit. Calibrate once every evaluator of the job has submitted, or have the administrator remove the outstanding evaluation.`;
}

export function openEvaluationCount(db: DB, userId: number): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM evaluations WHERE evaluator_id = ? AND status IN ${OPEN_SQL}`).get(userId) as { n: number }).n;
}
export function openRequestCount(db: DB, userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM questionnaire_responses WHERE user_id = ? AND status <> 'submitted'").get(userId) as { n: number }).n;
}
