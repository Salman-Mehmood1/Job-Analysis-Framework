import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EvaluationResult } from '../../../shared/engine';
import { api, type Company, type Department, type Evaluation, type JdAnalysis, type Position, type SavedAnalysis } from '../api';
import { EvaluationForm, ResultStrip } from '../components/EvaluationForm';
import { ErrorAlert, Modal, fmt, fmtDate } from '../components/ui';
import { useData, useUser } from '../hooks';

type Outcome = { id: number; analysis: JdAnalysis; result: EvaluationResult; title: string };

function CommitModal({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  const user = useUser();
  const nav = useNavigate();
  const positions = useData<Position[]>('/positions');
  const companies = useData<Company[]>('/companies');
  const departments = useData<Department[]>('/departments');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [positionId, setPositionId] = useState<number | ''>('');
  const [p, setP] = useState({ code: '', title: outcome.title, jobFamily: outcome.analysis.suggested.jobFamily, companyId: 0, departmentId: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const depts = (departments.data ?? []).filter((d) => d.companyId === p.companyId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ evaluationId: number }>(
        `/jd/analyses/${outcome.id}/commit`,
        mode === 'existing' ? { positionId } : { newPosition: p },
      );
      nav(`/${user.role}/evaluations/${r.evaluationId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Save as an evaluation" onClose={onClose}>
      <p className="small muted">
        Files this assessment as a submitted evaluation ({fmt(outcome.result.totalPoints)} pts, grade {outcome.result.grade ?? '—'}), so it appears in the dashboard and grade groupings and can be reviewed by management.
      </p>
      <ErrorAlert error={error} />
      <div className="tabs">
        <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>New position</button>
        <button className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>Existing position</button>
      </div>
      {mode === 'existing' ? (
        <label className="field">Position
          <select value={positionId} onChange={(e) => setPositionId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose…</option>
            {(positions.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.title} ({x.companyName})</option>)}
          </select>
        </label>
      ) : (
        <div className="form-grid">
          <label className="field">Code<input value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} placeholder="e.g. FIN-12" /></label>
          <label className="field">Title<input value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} /></label>
          <label className="field">Job family<input value={p.jobFamily} onChange={(e) => setP({ ...p, jobFamily: e.target.value })} /></label>
          <label className="field">Company
            <select value={p.companyId} onChange={(e) => setP({ ...p, companyId: Number(e.target.value), departmentId: 0 })}>
              <option value={0}>Choose…</option>
              {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Department
            <select value={p.departmentId} onChange={(e) => setP({ ...p, departmentId: Number(e.target.value) })} disabled={!p.companyId}>
              <option value={0}>Choose…</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {outcome.analysis.suggested.department && mode === 'new' && (
        <p className="small muted" style={{ marginTop: 8 }}>Suggested department: {outcome.analysis.suggested.department}</p>
      )}
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={submit}
          disabled={busy || (mode === 'existing' ? !positionId : !p.code || !p.title || !p.companyId || !p.departmentId)}>
          Save evaluation
        </button>
      </div>
    </Modal>
  );
}

function ApplyToAssignment({ outcome }: { outcome: Outcome }) {
  const nav = useNavigate();
  const evals = useData<Evaluation[]>('/evaluations');
  const open = (evals.data ?? []).filter((e) => ['assigned', 'in_progress', 'returned'].includes(e.status));
  const [id, setId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    try {
      const rationale = `JD analysis (${outcome.analysis.method === 'ai' ? 'AI' : 'rule-based'}): ${outcome.analysis.summary}\n` +
        Object.entries(outcome.analysis.rationale).map(([k, v]) => `${k} ${v.level}: ${v.reason}`).join('\n');
      await api.put(`/evaluations/${id}/inputs`, { inputs: outcome.analysis.inputs, rationale, source: 'jd_analysis' });
      nav(`/evaluator/evaluations/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!open.length) return <p className="small muted">You have no open assignments to apply this to.</p>;
  return (
    <div>
      <ErrorAlert error={error} />
      <div className="row">
        <select value={id} onChange={(e) => setId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Apply to one of my assignments…</option>
          {open.map((e) => <option key={e.id} value={e.id}>{e.position.code} · {e.position.title}</option>)}
        </select>
        <button className="primary" disabled={!id} onClick={apply}>Apply levels</button>
      </div>
      <p className="small muted">This replaces the levels in that draft. You can still edit them before submitting.</p>
    </div>
  );
}

export default function JdAnalyzerPage() {
  const user = useUser();
  const status = useData<{ aiEnabled: boolean; model: string | null }>('/jd/status');
  const history = useData<SavedAnalysis[]>('/jd/analyses');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [method, setMethod] = useState<'auto' | 'ai' | 'rules'>('auto');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: number; analysis: JdAnalysis; result: EvaluationResult }>('/jd/analyze', { title, text, method });
      setOutcome({ ...r, title: title || r.analysis.suggested.title });
      history.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) return setError('That file is too large; paste the text instead.');
    setText(await f.text());
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
  };

  const ai = status.data?.aiEnabled;
  const a = outcome?.analysis;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Job description analyser</h1>
          <p className="muted">Run an independent Hay assessment straight from a job description. The analyser proposes every level with its reasoning; the points and grade come from the same engine as manual evaluations.</p>
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className={`alert ${ai ? 'info' : 'warn'}`}>
        {ai ? <>AI analysis is on ({status.data?.model}).</> : <>AI analysis is not configured on this server, so the rule-based analyser is used. Set <code>ANTHROPIC_API_KEY</code> on the server to enable it.</>}
      </div>

      <div className="card">
        <div className="form-grid">
          <label className="field">Job title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Procurement Manager" /></label>
          <label className="field">Method
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="auto">Automatic {ai ? '(AI)' : '(rule-based)'}</option>
              <option value="ai" disabled={!ai}>AI (Claude)</option>
              <option value="rules">Rule-based</option>
            </select>
          </label>
          <label className="field">Load from file (.txt, .md)<input type="file" accept=".txt,.md,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} /></label>
        </div>
        <label className="field" style={{ marginTop: 12 }}>Job description
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Paste the job description: purpose, key responsibilities, reporting line, team size, budget or revenue figures, qualifications and experience…" />
        </label>
        <div className="row spread" style={{ marginTop: 12 }}>
          <span className="small muted">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ''} · Budget, team size and qualifications improve accuracy.</span>
          <button className="primary" disabled={busy || text.trim().length < 20} onClick={run}>{busy ? 'Analysing…' : 'Analyse'}</button>
        </div>
      </div>

      {outcome && a && (
        <div className="card">
          <div className="row spread">
            <h2>Assessment: {outcome.title || 'Untitled job'}</h2>
            <span className="badge b-neutral">{a.method === 'ai' ? `AI · ${a.model}` : 'Rule-based'} · {a.confidence} confidence</span>
          </div>
          <p>{a.summary}</p>
          {a.warnings.map((w) => <div key={w} className="small flag">⚠ {w}</div>)}
          <div style={{ margin: '12px 0' }}><ResultStrip result={outcome.result} /></div>
          <EvaluationForm inputs={a.inputs} readOnly result={outcome.result} reasons={a.rationale} />
          <div style={{ marginTop: 16 }}>
            {user.role === 'evaluator' ? (
              <ApplyToAssignment outcome={outcome} />
            ) : (
              <button className="primary" onClick={() => setCommitting(true)}>Save as evaluation…</button>
            )}
          </div>
        </div>
      )}

      <div className="card table-wrap">
        <h2>{user.role === 'evaluator' ? 'My analyses' : 'All analyses in the organisation'}</h2>
        <table>
          <thead><tr><th>Date</th><th>Job</th><th>By</th><th>Method</th><th className="num">Points</th><th className="num">Grade</th><th>Linked position</th><th /></tr></thead>
          <tbody>
            {(history.data ?? []).map((h) => (
              <tr key={h.id}>
                <td>{fmtDate(h.createdAt)}</td>
                <td>{h.title}</td>
                <td>{h.userName}</td>
                <td>{h.method === 'ai' ? 'AI' : 'Rules'}</td>
                <td className="num">{fmt(h.score.totalPoints)}</td>
                <td className="num">{h.score.grade ?? '—'}</td>
                <td>{h.positionCode ?? <span className="muted">—</span>}</td>
                <td><button className="ghost" onClick={() => { setTitle(h.title); setText(h.jdText); setOutcome({ id: h.id, analysis: h.analysis, result: h.score, title: h.title }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Open</button></td>
              </tr>
            ))}
            {!history.data?.length && <tr><td colSpan={8} className="muted">No analyses yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {committing && outcome && <CommitModal outcome={outcome} onClose={() => setCommitting(false)} />}
    </div>
  );
}
