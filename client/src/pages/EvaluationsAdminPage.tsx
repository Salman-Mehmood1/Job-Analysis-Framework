import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Evaluation, type OrgUser, type Position } from '../api';
import { type Filters, SlicerBar, applyFilters } from '../components/Slicers';
import { ErrorAlert, Modal, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData } from '../hooks';

function AssignModal({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const positions = useData<Position[]>('/positions');
  const users = useData<OrgUser[]>('/users');
  const evals = useData<Evaluation[]>('/evaluations');
  const [selected, setSelected] = useState<number[]>([]);
  const [evaluatorId, setEvaluatorId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [instructions, setInstructions] = useState('');
  const [q, setQ] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const evaluators = (users.data ?? []).filter((u) => u.role === 'evaluator' && u.active);
  const covered = new Set((evals.data ?? []).map((e) => e.position.id));
  const list = (positions.data ?? []).filter(
    (p) =>
      (!onlyUnassigned || !covered.has(p.id)) &&
      `${p.code} ${p.title} ${p.companyName} ${p.departmentName}`.toLowerCase().includes(q.toLowerCase()),
  );

  const submit = async () => {
    if (!evaluatorId || !selected.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/evaluations', { positionIds: selected, evaluatorId, dueDate: dueDate || null, instructions });
      onDone(selected.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Assign evaluations" onClose={onClose}>
      <ErrorAlert error={error ?? positions.error ?? users.error} />
      <div className="form-grid">
        <label className="field">Evaluator
          <select value={evaluatorId} onChange={(e) => setEvaluatorId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose…</option>
            {evaluators.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.assigned - u.completed} open)</option>)}
          </select>
        </label>
        <label className="field">Due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>Instructions (optional)
        <textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </label>
      <div className="row spread" style={{ margin: '12px 0 6px' }}>
        <input placeholder="Search positions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <label className="row small"><input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Not yet evaluated only</label>
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
                <td>{p.code}</td><td>{p.title}</td><td className="muted small">{p.companyName} / {p.departmentName}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={4} className="muted">No positions. Add them on the Positions page.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row spread" style={{ marginTop: 16 }}>
        <span className="muted small">{selected.length} selected</span>
        <button className="primary" disabled={busy || !evaluatorId || !selected.length} onClick={submit}>
          Assign {selected.length || ''} to evaluator
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
                  <td>{r.position.title}</td>
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
          onDone={(n) => {
            setAssigning(false);
            setNotice(`Assigned ${n} evaluation${n === 1 ? '' : 's'}.`);
            evals.reload();
          }}
        />
      )}
    </div>
  );
}
