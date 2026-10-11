import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ELEMENT_KEYS, ELEMENT_LABEL } from '../../../shared/consensus';
import { evaluate, inputsComplete } from '../../../shared/engine';
import { api, type EvaluationInputs, type JobDetail } from '../api';
import { EvaluationForm, ResultStrip } from '../components/EvaluationForm';
import { BASIS_LABEL, rangeFlag, spreadFlag } from '../components/JobBits';
import { ErrorAlert, Modal, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData, useStructures, useUser } from '../hooks';

const PS_PERCENT_LABEL: Record<string, string> = { Low: 'Lower', High: 'Higher' };
const show = (v: string | undefined) => (v === undefined ? '' : v === '' ? '–' : PS_PERCENT_LABEL[v] ?? v);

export default function JobCalibrationPage() {
  const { positionId } = useParams();
  const user = useUser();
  const isMgmt = user.role === 'management';
  const panel = user.role === 'admin' ? '/admin' : '/management';
  const job = useData<JobDetail>(`/jobs/${positionId}`);
  const structures = useStructures();
  const [draft, setDraft] = useState<EvaluationInputs | null>(null);
  const [comment, setComment] = useState('');
  const [returning, setReturning] = useState<{ id: number; name: string } | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const j = job.data;
  const approved = j?.calibration?.status === 'approved';
  const saved = j ? j.calibration?.finalInputs ?? j.calibration?.adjustedInputs ?? j.consensus?.inputs ?? null : null;

  useEffect(() => {
    if (j) {
      setDraft(saved);
      setComment(j.calibration?.comment ?? '');
    }
  }, [j]); // eslint-disable-line react-hooks/exhaustive-deps

  const bands = structures.bandsFor(job.data?.gradeStructure.id);
  const draftResult = useMemo(() => (draft && bands ? evaluate(draft, bands) : null), [draft, bands]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const commentDirty = j && comment !== (j.calibration?.comment ?? '');

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      job.reload();
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (job.error) return <ErrorAlert error={job.error} />;
  if (!j || !bands) return <div className="muted">Loading…</div>;
  if (j.mode !== 'multi') {
    return (
      <div className="card">
        This job has a single evaluator, so there is nothing to calibrate.{' '}
        <Link to={`${panel}/evaluations/${j.evaluationId}`}>Open the evaluation</Link>
      </div>
    );
  }

  const rated = j.evaluations.filter((e) => ['submitted', 'approved'].includes(e.status) && e.originalResult?.complete);
  const pending = j.evaluations.filter((e) => !rated.includes(e));
  const consensus = j.consensus;
  const canApprove = isMgmt && !approved && rated.length >= 2 && !!draft && inputsComplete(draft);
  const flag = spreadFlag(j);
  const outside = rangeFlag(j, (isMgmt && !approved ? draftResult : j.result)?.totalPoints);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="small"><Link to={isMgmt ? '/management/review?tab=calibration' : '/admin'}>← Back</Link></div>
          <h1>{j.position.code} · {j.position.title}</h1>
          <div className="row">
            <StatusBadge status={j.status} />
            <span className="badge b-neutral">{BASIS_LABEL[j.basis]}</span>
            <span className="muted">{j.company.name} / {j.department.name} · {j.evaluationCount} evaluators, {rated.length} submitted</span>
            <span className="badge b-neutral">{j.gradeStructure.name}</span>
          </div>
        </div>
        {isMgmt && (
          <div className="row">
            {!approved ? (
              <button className="primary" disabled={busy || !canApprove || dirty}
                title={dirty ? 'Save or discard your changes first' : rated.length < 2 ? 'Needs at least two submitted evaluations' : ''}
                onClick={() => run(() => api.post(`/jobs/${j.id}/calibration/approve`, { comment }), 'Calibration approved. This is now the job’s official result.')}>
                Approve calibration
              </button>
            ) : (
              <button disabled={busy} onClick={() => confirm('Reopen this calibration? The job goes back to provisional and the evaluations back to awaiting review.') &&
                run(() => api.post(`/jobs/${j.id}/calibration/reopen`), 'Calibration reopened.')}>
                Reopen calibration
              </button>
            )}
          </div>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {rated.length < 2 && <div className="alert info">Calibration needs at least two submitted evaluations. {rated.length} of {j.evaluationCount} submitted so far.</div>}
      {approved && (
        <div className="alert ok">
          Approved by {j.calibration?.approvedBy} on {fmtDate(j.calibration?.approvedAt)} from {j.calibration?.includedIds.length} evaluations.
          {j.evaluations.some((e) => !j.calibration!.includedIds.includes(e.id) && rated.includes(e)) && ' Some evaluations were submitted after approval; reopen to include them.'}
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <h2>{approved ? 'Calibrated result' : 'Agreed result (provisional)'}</h2>
          {j.spread && (
            <span className="small muted">
              Evaluators ranged {fmt(j.spread.minPoints)}–{fmt(j.spread.maxPoints)} pts, grade {j.spread.minGrade}–{j.spread.maxGrade}
              {flag && <span className="flag"> · {flag}</span>}
            </span>
          )}
        </div>
        <ResultStrip result={isMgmt && !approved ? draftResult : j.result} payTable={structures.payFor(j.gradeStructure.id)} />
        {outside && <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>{outside}{approved ? '.' : '. Check the agreed levels before approving.'}</div>}
      </div>

      <div className="card table-wrap">
        <h2>Evaluator comparison</h2>
        <p className="small muted">
          Consensus takes the most common level for each element. Where evaluators are evenly split, the tied levels are chosen so the
          consensus total stays closest to the evaluators’ median score. Highlighted cells differ from the consensus.
        </p>
        {rated.length === 0 ? <p className="muted">No submitted evaluations yet.</p> : (
          <table>
            <thead>
              <tr>
                <th>Element</th>
                {rated.map((e) => <th key={e.id}>{e.evaluator?.name ?? 'JD analysis'}</th>)}
                <th>Consensus</th>
                <th>Agreement</th>
                {(j.calibration?.adjustedInputs || approved) && <th>Agreed</th>}
              </tr>
            </thead>
            <tbody>
              {ELEMENT_KEYS.map((k) => {
                const c = consensus?.elements[k];
                const agreed = (j.calibration?.finalInputs ?? j.calibration?.adjustedInputs)?.[k] as string | undefined;
                return (
                  <tr key={k}>
                    <td className="small">{ELEMENT_LABEL[k]}</td>
                    {rated.map((e) => {
                      const v = e.inputs![k] as string;
                      const off = c && !(k === 'acImpact' && e.inputs!.acMagnitude === 'N') && v !== c.level;
                      return <td key={e.id} style={off ? { background: 'var(--warn-soft)', color: 'var(--warn)', fontWeight: 600 } : undefined}>{show(v)}</td>;
                    })}
                    <td><strong>{show(c?.level)}</strong></td>
                    <td className={c?.disagreement ? 'flag' : 'muted small'}>{c && c.total ? `${c.votes}/${c.total}` : '—'}</td>
                    {(j.calibration?.adjustedInputs || approved) && (
                      <td style={agreed !== undefined && agreed !== c?.level ? { fontWeight: 700, color: 'var(--accent)' } : undefined}>{show(agreed)}</td>
                    )}
                  </tr>
                );
              })}
              {(['khPoints', 'psPoints', 'acPoints', 'totalPoints'] as const).map((k) => (
                <tr key={k}>
                  <td className="small"><strong>{{ khPoints: 'Know-How pts', psPoints: 'Problem Solving pts', acPoints: 'Accountability pts', totalPoints: 'Total points' }[k]}</strong></td>
                  {rated.map((e) => <td key={e.id} className="num">{fmt(e.originalResult![k])}</td>)}
                  <td className="num"><strong>{fmt(consensus ? evaluate(consensus.inputs, bands)[k] : null)}</strong></td>
                  <td />
                  {(j.calibration?.adjustedInputs || approved) && <td className="num">{fmt(j.result?.[k])}</td>}
                </tr>
              ))}
              <tr>
                <td className="small"><strong>Grade</strong></td>
                {rated.map((e) => <td key={e.id} className="num">{e.originalResult!.grade ?? '—'}</td>)}
                <td className="num"><strong>{consensus ? evaluate(consensus.inputs, bands).grade ?? '—' : '—'}</strong></td>
                <td />
                {(j.calibration?.adjustedInputs || approved) && <td className="num">{j.result?.grade ?? '—'}</td>}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {isMgmt && !approved && draft && rated.length > 0 && (
        <div className="card">
          <div className="row spread">
            <h2>Adjust the agreed levels</h2>
            <span className="small muted">Starts from the consensus; dashed buttons show the consensus level where you change it.</span>
          </div>
          <EvaluationForm inputs={draft} onChange={setDraft} result={draftResult} compareTo={consensus?.inputs ?? null} />
          <label className="field" style={{ marginTop: 12 }}>Calibration note
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why the agreed levels differ from the consensus, or what the panel agreed" />
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy || (!dirty && !commentDirty) || !inputsComplete(draft)}
              onClick={() => run(() => api.put(`/jobs/${j.id}/calibration`, {
                inputs: JSON.stringify(draft) === JSON.stringify(consensus?.inputs) ? null : draft, comment,
              }), 'Agreed levels saved.')}>
              Save
            </button>
            {dirty && <button onClick={() => setDraft(saved)}>Discard changes</button>}
            {j.calibration?.adjustedInputs && (
              <button className="danger" disabled={busy} onClick={() => run(() => api.put(`/jobs/${j.id}/calibration`, { inputs: null, comment }), 'Reverted to the consensus.')}>
                Revert to consensus
              </button>
            )}
          </div>
        </div>
      )}
      {(!isMgmt || approved) && j.calibration?.comment && <div className="card"><h2>Calibration note</h2><p>{j.calibration.comment}</p></div>}

      <div className="card table-wrap">
        <h2>Evaluations</h2>
        <table>
          <thead><tr><th>Evaluator</th><th>Status</th><th>Submitted</th><th className="num">Points</th><th className="num">Grade</th><th>Rationale</th><th /></tr></thead>
          <tbody>
            {[...rated, ...pending].map((e) => (
              <tr key={e.id}>
                <td><Link to={`${panel}/evaluations/${e.id}`}>{e.evaluator?.name ?? 'JD analysis'}</Link></td>
                <td><StatusBadge status={e.status} /></td>
                <td>{fmtDate(e.submittedAt)}</td>
                <td className="num">{rated.includes(e) ? fmt(e.originalResult?.totalPoints) : '—'}</td>
                <td className="num">{rated.includes(e) ? e.originalResult?.grade ?? '—' : '—'}</td>
                <td className="small" style={{ maxWidth: 360 }}>
                  {e.rationale ? <details><summary>Show</summary><pre className="wrap">{e.rationale}</pre></details> : <span className="muted">—</span>}
                </td>
                <td>
                  {isMgmt && !approved && e.status === 'submitted' && (
                    <button className="ghost" onClick={() => { setReturning({ id: e.id, name: e.evaluator?.name ?? 'evaluator' }); setReturnNote(''); }}>Return</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {returning && (
        <Modal title={`Return to ${returning.name}`} onClose={() => setReturning(null)}>
          <p className="small muted">Their evaluation leaves the consensus until they resubmit. They only see your comment, not the other evaluations.</p>
          <textarea rows={3} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="What should they revisit?" />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => setReturning(null)}>Cancel</button>
            <button className="primary" disabled={!returnNote.trim() || busy} onClick={() => {
              const id = returning.id;
              setReturning(null);
              run(() => api.post(`/evaluations/${id}/return`, { comment: returnNote }), 'Returned to the evaluator.');
            }}>Return</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
