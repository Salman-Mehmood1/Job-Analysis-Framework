import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Evaluation, type OrgUser, type Position } from '../api';
import { type PeopleChoice, PeoplePicker, peopleOfPosition } from '../components/PeoplePicker';
import { type Filters, SlicerBar, applyFilters } from '../components/Slicers';
import { ErrorAlert, Modal, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData } from '../hooks';

interface AssignResult {
  ids: number[];
  skipped: { positionId: number; evaluatorId: number; reason: string }[];
  invited: number[];
  inviteSkipped: { positionId: number; name: string; role: 'JH' | 'LM'; reason: string }[];
}

function AssignModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string, warnings: string[]) => void }) {
  const positions = useData<Position[]>('/positions');
  const users = useData<OrgUser[]>('/users');
  const evals = useData<Evaluation[]>('/evaluations');
  const [selected, setSelected] = useState<number[]>([]);
  const [evaluatorIds, setEvaluatorIds] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState<'direct' | 'questionnaire'>('direct');
  const [instructions, setInstructions] = useState('');
  const [q, setQ] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Questionnaire: who answers it per position (defaults come from the position).
  const [picks, setPicks] = useState<Record<number, PeopleChoice>>({});
  const [saveAsDefaults, setSaveAsDefaults] = useState(true);
  const [respondentDue, setRespondentDue] = useState('');
  const positionById = new Map((positions.data ?? []).map((p) => [p.id, p]));
  const pickFor = (pid: number) => picks[pid] ?? peopleOfPosition(positionById.get(pid));
  const evaluatorsOf = (pid: number) => [...evaluatorIds, ...(evals.data ?? []).filter((e) => e.position.id === pid && e.evaluator).map((e) => e.evaluator!.id)];
  const noLineManager = selected.filter((pid) => !pickFor(pid).lineManagerId);

  const evaluators = (users.data ?? []).filter((u) => u.role === 'evaluator' && u.active);
  const covered = new Set((evals.data ?? []).map((e) => e.position.id));
  const ratersOf = (pid: number) => (evals.data ?? []).filter((e) => e.position.id === pid).map((e) => e.evaluator?.name ?? 'JD analysis');
  const list = (positions.data ?? []).filter(
    (p) =>
      (!onlyUnassigned || !covered.has(p.id)) &&
      `${p.code} ${p.title} ${p.companyName} ${p.departmentName}`.toLowerCase().includes(q.toLowerCase()),
  );

  const submit = async () => {
    if (!evaluatorIds.length || !selected.length) return;
    setBusy(true);
    setError(null);
    try {
      const respondents = method === 'questionnaire' ? selected.map((pid) => ({ positionId: pid, ...pickFor(pid) })) : undefined;
      const r = await api.post<AssignResult>('/evaluations', {
        positionIds: selected, evaluatorIds, dueDate: dueDate || null, instructions, method,
        respondents, saveAsDefaults, respondentDueDate: respondentDue || null,
      });
      const code = (pid: number) => positionById.get(pid)?.code ?? pid;
      const evName = (id: number) => evaluators.find((u) => u.id === id)?.name ?? id;
      const n = r.ids.length;
      onDone(
        `Assigned ${n} evaluation${n === 1 ? '' : 's'}.${r.invited.length ? ` Asked ${r.invited.length} line manager / job holder response${r.invited.length === 1 ? '' : 's'}.` : ''}`,
        [
          ...r.skipped.map((x) => `${code(x.positionId)}: ${evName(x.evaluatorId)} ${x.reason} (not assigned).`),
          ...r.inviteSkipped.map((x) => `${code(x.positionId)}: ${x.name} ${x.reason} (not asked as ${x.role === 'LM' ? 'line manager' : 'job holder'}).`),
        ],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Assign evaluations" onClose={onClose} wide>
      <ErrorAlert error={error ?? positions.error ?? users.error} />
      <div className="field small">Evaluators</div>
      <div className="row" style={{ gap: 4, marginTop: 4 }}>
        {evaluators.map((u) => (
          <label key={u.id} className={`btn choice${evaluatorIds.includes(u.id) ? ' on' : ''}`}>
            <input type="checkbox" style={{ display: 'none' }} checked={evaluatorIds.includes(u.id)}
              onChange={(e) => setEvaluatorIds(e.target.checked ? [...evaluatorIds, u.id] : evaluatorIds.filter((x) => x !== u.id))} />
            {u.name} <span className="small" style={{ opacity: 0.75 }}>({u.assigned - u.completed} open)</span>
          </label>
        ))}
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        {evaluatorIds.length > 1
          ? `Each job goes to all ${evaluatorIds.length} evaluators. They score independently, cannot see each other’s evaluations, and management calibrates the results.`
          : 'Pick more than one evaluator to have a job scored independently and then calibrated.'}
      </p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="field">Due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        <label className="field">Method
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="direct">Enter levels directly</option>
            <option value="questionnaire">Questionnaire pack (line manager, optional job holder)</option>
          </select>
        </label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>Instructions (optional)
        <textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </label>
      <div className="row spread" style={{ margin: '12px 0 6px' }}>
        <input placeholder="Search positions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <label className="row small"><input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Not yet assigned only</label>
      </div>
      <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all" checked={list.length > 0 && list.every((p) => selected.includes(p.id))}
                onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...list.map((p) => p.id)])] : selected.filter((id) => !list.some((p) => p.id === id)))} /></th>
              <th>Code</th><th>Role</th><th>Company / department</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} /></td>
                <td>{p.code}</td>
                <td>{p.title}{covered.has(p.id) && <div className="small muted">Already with: {ratersOf(p.id).join(', ')}</div>}</td>
                <td className="muted small">{p.companyName} / {p.departmentName}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={4} className="muted">No positions. Add them on the Positions page.</td></tr>}
          </tbody>
        </table>
      </div>
      {method === 'questionnaire' && selected.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Who answers the questionnaire</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Each job’s line manager answers the questionnaire; job holders are optional. Pre-filled from the position. Anyone in the organisation can be chosen except the job’s evaluators.
          </p>
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table>
              <tbody>
                {selected.map((pid) => {
                  const p = positionById.get(pid);
                  return (
                    <tr key={pid}>
                      <td style={{ width: 170 }}><strong>{p?.code}</strong><div className="small muted">{p?.title}</div></td>
                      <td><PeoplePicker compact users={users.data ?? []} value={pickFor(pid)} blocked={evaluatorsOf(pid)} onChange={(v) => setPicks({ ...picks, [pid]: v })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="row small"><input type="checkbox" checked={saveAsDefaults} onChange={(e) => setSaveAsDefaults(e.target.checked)} /> Save as each position’s line manager / job holders</label>
            <label className="row small" style={{ marginLeft: 'auto' }}>Their due date
              <input type="date" value={respondentDue} onChange={(e) => setRespondentDue(e.target.value)} />
            </label>
          </div>
          {noLineManager.length > 0 && (
            <div className="alert warn small" style={{ marginTop: 8, marginBottom: 0 }}>
              No line manager for {noLineManager.map((pid) => positionById.get(pid)?.code).join(', ')}. You can ask one later from the evaluation or the questionnaire requests page.
            </div>
          )}
        </div>
      )}
      <div className="row spread" style={{ marginTop: 16 }}>
        <span className="muted small">{selected.length} job{selected.length === 1 ? '' : 's'} × {evaluatorIds.length} evaluator{evaluatorIds.length === 1 ? '' : 's'}</span>
        <button className="primary" disabled={busy || !evaluatorIds.length || !selected.length} onClick={submit}>
          Assign {selected.length * evaluatorIds.length || ''} evaluation{selected.length * evaluatorIds.length === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}

export default function EvaluationsAdminPage() {
  const nav = useNavigate();
  const evals = useData<Evaluation[]>('/evaluations');
  const [filters, setFilters] = useState<Filters>({});
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const rows = useMemo(() => applyFilters(evals.data ?? [], filters), [evals.data, filters]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Evaluations &amp; assignments</h1>
          <p className="muted">Every evaluation in the organisation. Assign positions to evaluators and track progress.</p>
        </div>
        <button className="primary" onClick={() => setAssigning(true)}>+ Assign evaluations</button>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      {warnings.length > 0 && <div className="alert warn">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}
      <ErrorAlert error={evals.error} />
      <SlicerBar rows={evals.data ?? []} filters={filters} onChange={setFilters} dims={['status', 'evaluator', 'company', 'department', 'grade']} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Role</th><th>Company / department</th><th>Evaluator</th><th>Due</th><th>Status</th><th className="num">Points</th><th className="num">Grade</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = r.dueDate && r.dueDate < today && ['assigned', 'in_progress', 'returned'].includes(r.status);
              return (
                <tr key={r.id} className="clickable" onClick={() => nav(`/admin/evaluations/${r.id}`)}>
                  <td>{r.position.code}</td>
                  <td>
                    {r.position.title}
                    {(r.raterCount ?? 1) > 1 && (
                      <Link className="badge b-neutral" style={{ marginLeft: 6, textDecoration: 'none' }} to={`/admin/jobs/${r.position.id}`} onClick={(e) => e.stopPropagation()}>
                        {r.raterCount} evaluators · calibration
                      </Link>
                    )}
                  </td>
                  <td className="small">{r.company.name} / {r.department.name}</td>
                  <td>{r.evaluator?.name ?? <span className="muted">JD analysis</span>}</td>
                  <td className={overdue ? 'flag' : ''}>{fmtDate(r.dueDate)}{overdue ? ' (overdue)' : ''}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num">{fmt(r.result?.totalPoints)}</td>
                  <td className="num">{r.result?.grade ?? '—'}</td>
                </tr>
              );
            })}
            {!rows.length && !evals.loading && <tr><td colSpan={8} className="muted">No evaluations yet. Use “Assign evaluations” to start.</td></tr>}
          </tbody>
        </table>
      </div>
      {assigning && (
        <AssignModal
          onClose={() => setAssigning(false)}
          onDone={(msg, w) => {
            setAssigning(false);
            setNotice(msg);
            setWarnings(w);
            evals.reload();
          }}
        />
      )}
    </div>
  );
}
