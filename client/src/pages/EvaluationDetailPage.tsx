import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EMPTY_INPUTS, evaluate, inputsComplete } from '../../../shared/engine';
import { api, type Evaluation, type EvaluationInputs, type OrgUser } from '../api';
import { EvaluationForm, ResultStrip } from '../components/EvaluationForm';
import { EvaluatorQuestionnaire, RespondentsCard } from '../components/EvaluatorQuestionnaire';
import { RESPONDENT_ROLE_LABEL } from '../api';
import { ErrorAlert, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData, useStructures, useUser } from '../hooks';

const ACTION_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  reassigned: 'Reassigned',
  started: 'Evaluation started',
  submitted: 'Submitted for review',
  adjusted: 'Adjusted by management',
  adjustment_cleared: 'Adjustment removed',
  approved: 'Approved',
  returned: 'Returned to evaluator',
  created_from_jd_analysis: 'Created from job description analysis',
  calibrated: 'Approved through calibration',
  calibration_reopened: 'Calibration reopened',
};

function historyDetail(action: string, d: Record<string, unknown>) {
  if (action === 'adjusted') return `${fmt(d.fromPoints as number)} → ${fmt(d.toPoints as number)} pts, grade ${d.fromGrade ?? '—'} → ${d.toGrade ?? '—'}${d.comment ? ` — “${d.comment}”` : ''}`;
  if (action === 'returned') return `“${d.comment}”`;
  if (action === 'submitted' && d.totalPoints) return `${fmt(d.totalPoints as number)} pts, grade ${d.grade}`;
  if (action === 'created_from_jd_analysis') return d.method === 'ai' ? 'AI analysis' : 'Rule-based analysis';
  return '';
}

export default function EvaluationDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const nav = useNavigate();
  const isMgmt = user.role === 'management';
  const ev = useData<Evaluation>(`/evaluations/${id}`);
  const structures = useStructures();
  const users = useData<OrgUser[]>(user.role === 'admin' ? '/users' : null);
  const [draft, setDraft] = useState<EvaluationInputs | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const e = ev.data;
  useEffect(() => {
    if (e) {
      setDraft(e.adjustedInputs ?? e.inputs ?? { ...EMPTY_INPUTS });
      setComment(e.reviewComment ?? '');
    }
  }, [e]);

  const multi = (e?.raterCount ?? 1) > 1;
  const reviewable = isMgmt && e && !multi && ['submitted', 'approved'].includes(e.status);
  const bands = structures.bandsFor(ev.data?.gradeStructure.id);
  const draftResult = useMemo(() => (draft && bands ? evaluate(draft, bands) : null), [draft, bands]);
  const dirty = draft && e && JSON.stringify(draft) !== JSON.stringify(e.adjustedInputs ?? e.inputs);

  const run = async (fn: () => Promise<Evaluation | unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'id' in r) ev.setData({ ...(r as Evaluation), history: undefined });
      ev.reload();
      setNotice(msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (ev.error) return <ErrorAlert error={ev.error} />;
  if (!e || !draft) return <div className="muted">Loading…</div>;

  const back = multi ? `/${user.role}/jobs/${e.position.id}` : user.role === 'admin' ? '/admin/evaluations' : '/management/review';

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="small"><Link to={back}>← Back</Link></div>
          <h1>{e.position.code} · {e.position.title}</h1>
          <div className="row">
            <StatusBadge status={e.status} />
            <span className="muted">{e.company.name} / {e.department.name}</span>
            {e.position.jobFamily && <span className="muted">· {e.position.jobFamily}</span>}
            <span className="badge b-neutral" title={`Grade structure (${e.gradeStructure.source === 'position' ? 'assigned to this position' : e.gradeStructure.source === 'company' ? 'company default' : 'organisation default'})`}>{e.gradeStructure.name}</span>
            {e.source === 'jd_analysis' && <span className="badge b-neutral">from JD analysis</span>}
          </div>
        </div>
        {reviewable && (
          <div className="row">
            {e.status === 'submitted' && (
              <button className="primary" disabled={busy || !!dirty} title={dirty ? 'Save or discard your adjustment first' : ''}
                onClick={() => run(() => api.post(`/evaluations/${e.id}/approve`, { comment }), 'Evaluation approved.')}>
                Approve
              </button>
            )}
            <button disabled={busy} onClick={() => {
              if (!comment.trim()) return setError('Add a review comment saying what the evaluator should change.');
              run(() => api.post(`/evaluations/${e.id}/return`, { comment }), 'Returned to the evaluator.');
            }}>
              Return to evaluator
            </button>
          </div>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {multi && (
        <div className="alert info">
          This job has {e.raterCount} evaluators. Their scores are combined and calibrated at job level.{' '}
          <Link to={`/${user.role}/jobs/${e.position.id}`}>Open the calibration</Link>
        </div>
      )}

      <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <div className="stack">
          <div className="card">
            <div className="row spread">
              <h2>{e.adjustedInputs ? 'Adjusted result' : 'Result'}</h2>
              {e.adjustedInputs && e.originalResult && (
                <span className="small muted">Evaluator: {fmt(e.originalResult.totalPoints)} pts · grade {e.originalResult.grade ?? '—'} → Management: {fmt(e.result?.totalPoints)} pts · grade {e.result?.grade ?? '—'}</span>
              )}
            </div>
            <ResultStrip result={reviewable ? draftResult : e.result} />
          </div>

          {reviewable ? (
            <div className="card">
              <div className="row spread">
                <h2>Review &amp; adjust levels</h2>
                <span className="small muted">Dashed buttons show the evaluator’s original levels.</span>
              </div>
              <EvaluationForm inputs={draft} onChange={setDraft} result={draftResult} compareTo={e.inputs} />
              <label className="field" style={{ marginTop: 12 }}>Review comment
                <textarea rows={2} value={comment} onChange={(x) => setComment(x.target.value)} placeholder="Why the levels were adjusted, or what the evaluator should revisit" />
              </label>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" disabled={busy || !dirty || !inputsComplete(draft)}
                  onClick={() => run(() => api.put(`/evaluations/${e.id}/adjust`, { inputs: draft, comment }), 'Adjustment saved.')}>
                  Save adjustment
                </button>
                {dirty && <button onClick={() => setDraft(e.adjustedInputs ?? e.inputs ?? { ...EMPTY_INPUTS })}>Discard changes</button>}
                {e.adjustedInputs && (
                  <button className="danger" disabled={busy} onClick={() => run(() => api.del(`/evaluations/${e.id}/adjust`), 'Reverted to the evaluator’s levels.')}>
                    Revert to evaluator’s levels
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="card">
              <h2>Levels</h2>
              {e.inputs ? (
                <EvaluationForm inputs={e.adjustedInputs ?? e.inputs} readOnly result={e.result} compareTo={e.adjustedInputs ? e.inputs : null} />
              ) : (
                <p className="muted">The evaluator has not entered any levels yet.</p>
              )}
              {isMgmt && !multi && <p className="small muted" style={{ marginTop: 8 }}>Levels can be reviewed once the evaluator submits.</p>}
            </div>
          )}

          {e.questionnaire && (e.method === 'questionnaire' || e.questionnaire.respondents.length > 0) && (
            <div>
              <div className="row spread" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Questionnaire pack</h2>
                {e.method !== 'questionnaire' && <span className="badge b-neutral">Not used: levels entered directly</span>}
              </div>
              <EvaluatorQuestionnaire value={e.questionnaire.ev} respondents={e.questionnaire.respondents} readOnly />
            </div>
          )}
          {e.rationale && (
            <div className="card"><h2>Evaluator’s rationale</h2><pre className="wrap">{e.rationale}</pre></div>
          )}
          {e.position.jobDescription && (
            <div className="card"><h2>Job description</h2><pre className="wrap">{e.position.jobDescription}</pre></div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h2>Assignment</h2>
            <table>
              <tbody>
                <tr><td className="muted">Evaluator</td><td>{e.evaluator?.name ?? 'JD analysis (no evaluator)'}</td></tr>
                <tr><td className="muted">Assigned by</td><td>{e.assignedBy ?? '—'}</td></tr>
                <tr><td className="muted">Due</td><td>{fmtDate(e.dueDate)}</td></tr>
                <tr><td className="muted">Submitted</td><td>{fmtDate(e.submittedAt)}</td></tr>
                <tr><td className="muted">Approved</td><td>{fmtDate(e.approvedAt)}</td></tr>
                {e.adjustedBy && <tr><td className="muted">Adjusted by</td><td>{e.adjustedBy} · {fmtDate(e.adjustedAt)}</td></tr>}
              </tbody>
            </table>
            {e.instructions && <p className="small" style={{ marginTop: 8 }}><strong>Instructions:</strong> {e.instructions}</p>}
            {e.reviewComment && !reviewable && <p className="small"><strong>Review comment:</strong> {e.reviewComment}</p>}
            {user.role === 'admin' && <AdminAssignment e={e} users={users.data ?? []} busy={busy}
              onChange={(body, msg) => run(() => api.patch(`/evaluations/${e.id}/assignment`, body), msg)}
              onDelete={async () => {
                if (!confirm('Delete this evaluation and its history? The position itself is kept.')) return;
                await api.del(`/evaluations/${e.id}`);
                nav('/admin/evaluations');
              }} />}
          </div>
          {user.role === 'admin' ? (
            <RespondentsAdmin positionId={e.position.id} users={users.data ?? []} onChange={() => ev.reload()} />
          ) : e.questionnaire && e.questionnaire.respondents.length > 0 ? (
            <RespondentsCard respondents={e.questionnaire.respondents} />
          ) : null}
          <div className="card">
            <h2>History</h2>
            <ul className="timeline">
              {(e.history ?? []).map((h) => (
                <li key={h.id}>
                  <div><strong>{ACTION_LABEL[h.action] ?? h.action}</strong></div>
                  <div className="small muted">{h.user_name ?? 'System'} · {fmtDate(h.at)}</div>
                  {historyDetail(h.action, h.details) && <div className="small">{historyDetail(h.action, h.details)}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminAssignment({
  e,
  users,
  busy,
  onChange,
  onDelete,
}: {
  e: Evaluation;
  users: OrgUser[];
  busy: boolean;
  onChange: (body: object, msg: string) => void;
  onDelete: () => void;
}) {
  const [evaluatorId, setEvaluatorId] = useState(e.evaluator?.id ?? 0);
  const [due, setDue] = useState(e.dueDate ?? '');
  const open = ['assigned', 'in_progress', 'returned'].includes(e.status);
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {open && (
        <div className="row">
          <select value={evaluatorId} onChange={(x) => setEvaluatorId(Number(x.target.value))} style={{ flex: 1 }}>
            {!e.evaluator && <option value={0}>Choose evaluator…</option>}
            {users.filter((u) => u.role === 'evaluator' && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button disabled={busy || !evaluatorId || evaluatorId === e.evaluator?.id} onClick={() => onChange({ evaluatorId }, 'Evaluator changed.')}>Reassign</button>
        </div>
      )}
      <div className="row">
        <input type="date" value={due} onChange={(x) => setDue(x.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || due === (e.dueDate ?? '')} onClick={() => onChange({ dueDate: due || null }, 'Due date updated.')}>Set due date</button>
      </div>
      <button className="danger" onClick={onDelete}>Delete evaluation</button>
    </div>
  );
}

/** Admin: ask a job holder (optional) and line manager to answer the questionnaire for this job. */
function RespondentsAdmin({ positionId, users, onChange }: { positionId: number; users: OrgUser[]; onChange: () => void }) {
  const list = useData<{ id: number; role: 'JH' | 'LM'; status: string; userName: string; dueDate: string | null }[]>(`/questionnaire-responses?positionId=${positionId}`);
  const [userId, setUserId] = useState(0);
  const [role, setRole] = useState<'JH' | 'LM'>('LM');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const respondents = users.filter((u) => u.role === 'respondent' && u.active);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      list.reload();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card">
      <h2>Questionnaire respondents</h2>
      <p className="small muted">The line manager and, optionally, the job holder answer the questionnaire pack for this job. Shared by every evaluation of the job.</p>
      <ErrorAlert error={error ?? list.error} />
      <table>
        <tbody>
          {(list.data ?? []).map((r) => (
            <tr key={r.id}>
              <td>{RESPONDENT_ROLE_LABEL[r.role]}</td>
              <td>{r.userName}</td>
              <td><span className={`badge ${r.status === 'submitted' ? 'b-approved' : 'b-assigned'}`}>{r.status === 'invited' ? 'Not started' : r.status === 'in_progress' ? 'In progress' : 'Submitted'}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.status === 'submitted' && <button className="ghost" onClick={() => act(() => api.post(`/questionnaire-responses/${r.id}/reopen`))}>Reopen</button>}
                <button className="ghost danger" onClick={() => confirm(`Remove ${r.userName}? Their answers are deleted.`) && act(() => api.del(`/questionnaire-responses/${r.id}`))}>Remove</button>
              </td>
            </tr>
          ))}
          {!list.data?.length && <tr><td className="muted small">Nobody asked yet.</td></tr>}
        </tbody>
      </table>
      {respondents.length ? (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="row">
            <select value={role} onChange={(e) => setRole(e.target.value as 'JH' | 'LM')}>
              <option value="LM">Line manager</option>
              <option value="JH">Job holder (optional)</option>
            </select>
            <select value={userId} onChange={(e) => setUserId(Number(e.target.value))} style={{ flex: 1 }}>
              <option value={0}>Choose person…</option>
              {respondents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="row">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" style={{ flex: 1 }} />
            <button className="primary" disabled={!userId}
              onClick={() => act(async () => { await api.post('/questionnaire-responses', { positionId, userId, role, dueDate: due || null }); setUserId(0); })}>
              Ask to complete
            </button>
          </div>
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 8 }}>Add users with the “Job holder / line manager” role on the Users page first.</p>
      )}
    </div>
  );
}
