import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EMPTY_INPUTS, evaluate, inputsComplete } from '../../../shared/engine';
import { api, type Evaluation, type EvaluationInputs, type JdAnalysis } from '../api';
import { EvaluationForm, ResultStrip } from '../components/EvaluationForm';
import { ErrorAlert, StatusBadge, fmt, fmtDate } from '../components/ui';
import { EvaluatorQuestionnaire, RespondentsCard, useConsolidated } from '../components/EvaluatorQuestionnaire';
import { EMPTY_EV_QUESTIONNAIRE, type EvaluatorQuestionnaire as EvQ } from '../../../shared/questionnaire';
import { useData, useStructures } from '../hooks';

export default function EvaluatePage() {
  const { id } = useParams();
  const ev = useData<Evaluation>(`/evaluations/${id}`);
  const structures = useStructures();
  const [inputs, setInputs] = useState<EvaluationInputs>({ ...EMPTY_INPUTS });
  const [rationale, setRationale] = useState('');
  const [source, setSource] = useState<'manual' | 'jd_analysis'>('manual');
  const [suggestion, setSuggestion] = useState<JdAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qEdit, setQDraft] = useState<EvQ | null>(null);

  const e = ev.data;
  useEffect(() => {
    if (e) {
      setInputs(e.inputs ?? { ...EMPTY_INPUTS });
      setRationale(e.rationale);
      setSource(e.source);
      setQDraft(null);
    }
  }, [e]);

  // The administrator sets the method when assigning; the evaluator works with it.
  const method = e?.method ?? 'direct';
  const qDraft = qEdit ?? e?.questionnaire?.ev ?? EMPTY_EV_QUESTIONNAIRE;
  const respondents = e?.questionnaire?.respondents ?? [];
  const qResult = useConsolidated(qDraft, respondents);
  const isQ = method === 'questionnaire';
  // In questionnaire mode the levels come from the consolidated questionnaire.
  const shownInputs = isQ ? qResult.inputs : inputs;
  const bands = structures.bandsFor(ev.data?.gradeStructure.id);
  const result = useMemo(() => (bands ? evaluate(shownInputs, bands) : null), [shownInputs, bands]);
  const editable = e && ['assigned', 'in_progress', 'returned'].includes(e.status);
  const dirty =
    !!e &&
    (method !== e.method ||
      rationale !== e.rationale ||
      (isQ ? JSON.stringify(qDraft) !== JSON.stringify(e.questionnaire?.ev ?? EMPTY_EV_QUESTIONNAIRE) : JSON.stringify(inputs) !== JSON.stringify(e.inputs ?? EMPTY_INPUTS)));
  // A questionnaire evaluation also waits for the line manager (and any job holder asked) to answer.
  const waits = isQ ? e?.questionnaire?.waits ?? [] : [];
  const canSubmit = isQ ? qResult.complete && waits.length === 0 : inputsComplete(inputs);

  const save = async (submit: boolean) => {
    if (!e) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (dirty || !e.inputs) {
        if (isQ) await api.put(`/evaluations/${e.id}/questionnaire`, { questionnaire: qDraft, rationale });
        else await api.put(`/evaluations/${e.id}/inputs`, { inputs, rationale, source });
      }
      if (submit) {
        await api.post(`/evaluations/${e.id}/submit`);
        setNotice('Submitted for management review.');
      } else setNotice('Draft saved.');
      ev.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // "Save & next" in the questionnaire: keep the draft without a notice.
  const saveQuietly = async () => {
    if (!e || !dirty) return;
    try {
      await api.put(`/evaluations/${e.id}/questionnaire`, { questionnaire: qDraft, rationale });
      ev.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const analyse = async () => {
    if (!e) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ analysis: JdAnalysis }>('/jd/analyze', {
        title: e.position.title,
        text: e.position.jobDescription,
        positionId: e.position.id,
      });
      setSuggestion(r.analysis);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setInputs(suggestion.inputs);
    setSource('jd_analysis');
    const lines = Object.entries(suggestion.rationale).map(([k, v]) => `${k} ${v.level}: ${v.reason}`);
    setRationale((r) => `${r ? `${r}\n\n` : ''}JD analysis (${suggestion.method === 'ai' ? 'AI' : 'rule-based'}): ${suggestion.summary}\n${lines.join('\n')}`);
    setSuggestion(null);
  };

  if (ev.error) return <ErrorAlert error={ev.error} />;
  if (!e) return <div className="muted">Loading…</div>;
  const suggestedResult = suggestion && bands ? evaluate(suggestion.inputs, bands) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/evaluator">← My assignments</Link></div>
          <h1>{e.position.code} · {e.position.title}</h1>
          <div className="row">
            <StatusBadge status={e.status} />
            <span className="muted">{e.company.name} / {e.department.name}</span>
            {e.dueDate && <span className="muted">· due {fmtDate(e.dueDate)}</span>}
            <span className="muted">· graded on the {e.gradeStructure.name} structure</span>
          </div>
        </div>
        {editable && (
          <div className="row">
            <button disabled={busy || !dirty} onClick={() => save(false)}>Save draft</button>
            <button className="primary" disabled={busy || !canSubmit} onClick={() => save(true)}
              title={canSubmit ? '' : isQ ? (waits.length ? waits.join(' ') : 'Rate every question, set the magnitude and justify any override') : 'Set every element'}>
              Submit for review
            </button>
          </div>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {e.status === 'returned' && e.reviewComment && <div className="alert warn"><strong>Returned by management:</strong> {e.reviewComment}</div>}
      {e.instructions && <div className="alert info"><strong>Instructions:</strong> {e.instructions}</div>}
      {!editable && <div className="alert info">This evaluation is {e.status === 'approved' ? 'approved' : 'with management for review'} and can no longer be edited.</div>}

      <div className="card sticky" style={{ zIndex: 5 }}>
        <ResultStrip result={result} />
        {e.calibrated && (
          <p className="small" style={{ marginTop: 8 }}>
            Final calibrated result: <strong>{fmt(e.calibrated.result.totalPoints)} pts, grade {e.calibrated.result.grade}</strong> (see below).
          </p>
        )}
        {e.adjustedInputs && e.result && (
          <p className="small" style={{ marginTop: 8 }}>
            Management adjusted this evaluation to <strong>{fmt(e.result.totalPoints)} pts, grade {e.result.grade}</strong>
            {e.reviewComment && <> — “{e.reviewComment}”</>}.
          </p>
        )}
      </div>

      {e.calibrated && (
        <div className="card" style={{ borderColor: 'var(--ok)' }}>
          <div className="row spread">
            <h2>Final calibrated result</h2>
            <span className="badge b-approved">Approved {fmtDate(e.calibrated.approvedAt)}</span>
          </div>
          <p className="small muted">
            This job was calibrated by management. These are the agreed levels and the job’s official score.
            Where the agreed level differs from yours, your level is shown beside the element.
          </p>
          <ResultStrip result={e.calibrated.result} />
          {e.calibrated.comment && <p style={{ marginTop: 8 }}><strong>Calibration note:</strong> {e.calibrated.comment}</p>}
          <div style={{ marginTop: 12 }}>
            <EvaluationForm inputs={e.calibrated.inputs} readOnly result={e.calibrated.result} compareTo={e.inputs} compareLabel="you:" />
          </div>
        </div>
      )}

      {(editable || e.method === 'questionnaire') && (
        <div className="card">
          <div className="row spread">
            <div>
              <h2 style={{ marginBottom: 2 }}>{e.calibrated ? 'Your evaluation' : 'How to rate this job'}</h2>
              <p className="small muted" style={{ margin: 0 }}>
                {isQ
                  ? 'Questionnaire pack: rate each of the 35 weighted questions; the job holder and line manager answers are consolidated with yours into the eight levels.'
                  : 'Enter the eight levels directly.'}
              </p>
            </div>
            <span className="badge b-neutral" title="Set by the administrator">{isQ ? 'Questionnaire pack' : 'Levels entered directly'}</span>
          </div>
          {editable && isQ && waits.length > 0 && (
            <div className="alert warn small" style={{ margin: '12px 0 0' }}>
              <strong>You can rate and save now, but submit only after:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{waits.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {isQ ? (
        <>
          <RespondentsCard respondents={respondents} />
          <EvaluatorQuestionnaire value={qDraft} onChange={setQDraft} respondents={respondents} readOnly={!editable}
            onSave={saveQuietly} onSubmit={() => save(true)} canSubmit={canSubmit} busy={busy} scrollMargin={150} />
          <details className="card">
            <summary><strong>Resulting levels</strong> <span className="small muted">(carried to the scoring calculator)</span></summary>
            <div style={{ marginTop: 12 }}><EvaluationForm inputs={qResult.inputs} readOnly result={result} /></div>
          </details>
        </>
      ) : (
        <div className="card">
          {e.calibrated && !editable && <h2>Your evaluation</h2>}
          <EvaluationForm inputs={inputs} onChange={setInputs} readOnly={!editable} result={result} />
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Rationale</h2>
          <p className="small muted">Record the evidence behind your levels. Reviewers see this.</p>
          <textarea rows={8} value={rationale} onChange={(x) => setRationale(x.target.value)} disabled={!editable} />
        </div>
        <div className="card">
          <div className="row spread">
            <h2>Job description</h2>
            {editable && !isQ && e.position.jobDescription.trim().length >= 20 && (
              <button disabled={busy} onClick={analyse}>{busy ? 'Analysing…' : 'Suggest levels from JD'}</button>
            )}
          </div>
          {e.position.jobDescription ? <pre className="wrap">{e.position.jobDescription}</pre> : <p className="muted">No job description on file for this position.</p>}
          {suggestion && (
            <div className="alert info" style={{ marginTop: 12 }}>
              <div className="row spread">
                <strong>Suggested levels ({suggestion.method === 'ai' ? 'AI' : 'rule-based'}, {suggestion.confidence} confidence)</strong>
                <span>{fmt(suggestedResult?.totalPoints)} pts · grade {suggestedResult?.grade ?? '—'}</span>
              </div>
              <p className="small">{suggestion.summary}</p>
              <ul className="small" style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                {Object.entries(suggestion.rationale).map(([k, v]) => <li key={k}><strong>{v.level}</strong> — {v.reason}</li>)}
              </ul>
              {suggestion.warnings.map((w) => <div key={w} className="small flag">⚠ {w}</div>)}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={applySuggestion}>Apply to my evaluation</button>
                <button onClick={() => setSuggestion(null)}>Dismiss</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
