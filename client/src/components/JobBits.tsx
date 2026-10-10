import type { JobRecord } from '../api';

/** Where a job opens: its calibration page when it has several evaluators, else its single evaluation. */
export const jobHref = (panel: string, j: JobRecord) =>
  j.mode === 'multi' ? `${panel}/jobs/${j.id}` : `${panel}/evaluations/${j.evaluationId}`;

export const BASIS_LABEL: Record<JobRecord['basis'], string> = {
  evaluation: 'Single evaluation',
  consensus: 'Consensus (provisional)',
  adjusted_consensus: 'Adjusted consensus (provisional)',
  calibrated: 'Calibrated',
};

/** Small badges after a job title: evaluator count, provisional consensus, management adjustment. */
export function JobBadges({ j }: { j: JobRecord }) {
  return (
    <>
      {j.mode === 'multi' && (
        <span className="badge b-neutral" style={{ marginLeft: 6 }} title={j.evaluators.map((e) => e.name).join(', ')}>
          {j.evaluationCount} evaluators
        </span>
      )}
      {j.mode === 'multi' && j.basis !== 'calibrated' && j.result && (
        <span className="badge b-submitted" style={{ marginLeft: 6 }}>provisional</span>
      )}
      {j.adjusted && <span className="badge b-neutral" style={{ marginLeft: 6 }}>adjusted</span>}
    </>
  );
}

/** "Evaluators 2 grades apart" style flag, or null when they agree within one grade. */
export function spreadFlag(j: JobRecord): string | null {
  if (!j.spread) return null;
  const gap = j.spread.maxGrade - j.spread.minGrade;
  return gap > 1 ? `Evaluators ${gap} grades apart` : null;
}

/** Flag when the job's agreed score falls outside the range its evaluators gave. */
export function rangeFlag(j: JobRecord, total = j.result?.totalPoints): string | null {
  if (!j.spread || total == null) return null;
  return total < j.spread.minPoints || total > j.spread.maxPoints ? 'Agreed score outside evaluators’ range' : null;
}
