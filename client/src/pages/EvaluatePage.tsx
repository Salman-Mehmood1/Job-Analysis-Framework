import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EMPTY_INPUTS, evaluate, inputsComplete } from '../../../shared/engine';
import { api, type Evaluation, type EvaluationInputs, type GradeBand, type JdAnalysis } from '../api';
import { EvaluationForm, ResultStrip } from '../components/EvaluationForm';
import { ErrorAlert, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData } from '../hooks';

export default function EvaluatePage() {
  const { id } = useParams();
  const ev = useData<Evaluation>(`/evaluations/${id}`);
  const grades = useData<{ grades: GradeBand[] }>('/grades');
  const [inputs, setInputs] = useState<EvaluationInputs>({ ...EMPTY_INPUTS });
  const [rationale, setRationale] = useState('');
  const [source, setSource] = useState<'manual' | 'jd_analysis'>('manual');
  const [suggestion, setSuggestion] = useState<JdAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const e = ev.data;
  useEffect(() => {
    if (e) {
      setInputs(e.inputs ?? { ...EMPTY_INPUTS });
      setRationale(e.rationale);
      setSource(e.source);
    }
  }, [e]);

  const result = useMemo(() => (grades.data ? evaluate(inputs, grades.data.grades) : null), [inputs, grades.data]);
  const editable = e && ['assigned', 'in_progress', 'returned'].includes(e.status);
  const dirty = e && (JSON.stringify(inputs) !== JSON.stringify(e.inputs ?? EMPTY_INPUTS) || rationale !== e.rationale);

  const save = async (submit: boolean) => {
    if (!e) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (dirty || !e.inputs) await api.put(`/evaluations/${e.id}/inputs`, { inputs, rationale, source });
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
  const suggestedResult = suggestion && grades.data ? evaluate(suggestion.inputs, grades.data.grades) : null;

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
          </div>
        </div>
        {editable && (
          <div className="row">
            <button disabled={busy || !dirty} onClick={() => save(false)}>Save draft</button>
            <button className="primary" disabled={busy || !inputsComplete(inputs)} onClick={() => save(true)}>Submit for review</button>
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
        {e.adjustedInputs && e.result && (
          <p className="small" style={{ marginTop: 8 }}>
            Management adjusted this evaluation to <strong>{fmt(e.result.totalPoints)} pts, grade {e.result.grade}</strong>
            {e.reviewComment && <> — “{e.reviewComment}”</>}.
          </p>
        )}
      </div>

      <div className="card">
        <EvaluationForm inputs={inputs} onChange={setInputs} readOnly={!editable} result={result} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Rationale</h2>
          <p className="small muted">Record the evidence behind your levels. Reviewers see this.</p>
          <textarea rows={8} value={rationale} onChange={(x) => setRationale(x.target.value)} disabled={!editable} />
        </div>
        <div className="card">
          <div className="row spread">
            <h2>Job description</h2>
            {editable && e.position.jobDescription.trim().length >= 20 && (
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
