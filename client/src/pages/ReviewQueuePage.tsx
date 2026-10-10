import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Evaluation } from '../api';
import { type Filters, SlicerBar, applyFilters } from '../components/Slicers';
import { ErrorAlert, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData } from '../hooks';

export default function ReviewQueuePage() {
  const nav = useNavigate();
  const evals = useData<Evaluation[]>('/evaluations');
  const [filters, setFilters] = useState<Filters>({ status: ['submitted'] });
  const [picked, setPicked] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => applyFilters(evals.data ?? [], filters), [evals.data, filters]);
  const approvable = rows.filter((r) => r.status === 'submitted');

  const bulkApprove = async () => {
    if (!confirm(`Approve ${picked.length} evaluation(s) as submitted?`)) return;
    try {
      const r = await api.post<{ approved: number }>('/evaluations/approve-bulk', { ids: picked });
      setNotice(`Approved ${r.approved}.`);
      setPicked([]);
      evals.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Review queue</h1>
          <p className="muted">Submitted evaluations waiting for management. Open one to adjust levels, approve or return it.</p>
        </div>
        <button className="primary" disabled={!picked.length} onClick={bulkApprove}>Approve selected ({picked.length})</button>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      <ErrorAlert error={error ?? evals.error} />
      <SlicerBar rows={evals.data ?? []} filters={filters} onChange={setFilters} dims={['status', 'company', 'department', 'role', 'grade', 'evaluator']} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all" checked={approvable.length > 0 && approvable.every((r) => picked.includes(r.id))}
                onChange={(e) => setPicked(e.target.checked ? approvable.map((r) => r.id) : [])} /></th>
              <th>Code</th><th>Role</th><th>Company / department</th><th>Evaluator</th><th>Submitted</th><th>Status</th>
              <th className="num">Points</th><th className="num">Grade</th><th>Profile</th><th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/management/evaluations/${r.id}`)}>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.status === 'submitted' && (
                    <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                  )}
                </td>
                <td>{r.position.code}</td>
                <td>{r.position.title}{r.adjustedInputs && <span className="badge b-neutral" style={{ marginLeft: 6 }}>adjusted</span>}</td>
                <td className="small">{r.company.name} / {r.department.name}</td>
                <td>{r.evaluator?.name ?? <span className="muted">JD analysis</span>}</td>
                <td>{fmtDate(r.submittedAt)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="num">{fmt(r.result?.totalPoints)}</td>
                <td className="num">{r.result?.grade ?? '—'}</td>
                <td>{r.result?.profile ?? '—'}</td>
                <td className="small">{r.result?.complete ? (r.result.checks.length ? <span className="flag">{r.result.checks.join('; ')}</span> : 'OK') : ''}</td>
              </tr>
            ))}
            {!rows.length && !evals.loading && <tr><td colSpan={11} className="muted">Nothing matches. Clear the status slicer to see all evaluations.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
