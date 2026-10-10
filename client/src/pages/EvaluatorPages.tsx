import { useNavigate } from 'react-router-dom';
import type { Evaluation } from '../api';
import { ErrorAlert, Kpi, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData } from '../hooks';

const OPEN = ['assigned', 'in_progress', 'returned'];

export function MyEvaluationsPage() {
  const nav = useNavigate();
  const { data, error, loading } = useData<Evaluation[]>('/evaluations');
  const rows = data ?? [];
  const open = rows
    .filter((r) => OPEN.includes(r.status))
    .sort((a, b) => (a.status === 'returned' ? -1 : 0) - (b.status === 'returned' ? -1 : 0) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const done = rows.filter((r) => !OPEN.includes(r.status));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My assignments</h1>
          <p className="muted">Positions your administrator has asked you to evaluate.</p>
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <Kpi label="To do" value={open.length} />
        <Kpi label="Returned for changes" value={open.filter((r) => r.status === 'returned').length} />
        <Kpi label="Awaiting review" value={done.filter((r) => r.status === 'submitted').length} />
        <Kpi label="Approved" value={done.filter((r) => r.status === 'approved').length} />
      </div>
      <div className="card table-wrap">
        <h2>Open</h2>
        <table>
          <thead><tr><th>Code</th><th>Role</th><th>Company / department</th><th>Due</th><th>Status</th><th className="num">Points so far</th></tr></thead>
          <tbody>
            {open.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/evaluator/evaluations/${r.id}`)}>
                <td>{r.position.code}</td>
                <td>{r.position.title}{r.status === 'returned' && r.reviewComment && <div className="small flag">“{r.reviewComment}”</div>}</td>
                <td className="small">{r.company.name} / {r.department.name}</td>
                <td className={r.dueDate && r.dueDate < today ? 'flag' : ''}>{fmtDate(r.dueDate)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="num">{fmt(r.result?.totalPoints)}</td>
              </tr>
            ))}
            {!open.length && !loading && <tr><td colSpan={6} className="muted">Nothing to do right now.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MyResultsPage() {
  const nav = useNavigate();
  const { data, error } = useData<Evaluation[]>('/evaluations');
  const rows = (data ?? []).filter((r) => r.originalResult?.complete);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My results</h1>
          <p className="muted">Scores from the evaluations you have completed. The final score is shown alongside yours: management’s adjusted score or, for calibrated jobs, the approved calibrated result.</p>
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Role</th><th>Status</th>
              <th className="num">KH</th><th className="num">PS</th><th className="num">AC</th>
              <th className="num">Your total</th><th className="num">Your grade</th><th>Profile</th>
              <th className="num">Final total</th><th className="num">Final grade</th><th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const o = r.originalResult!;
              const final = r.calibrated?.result ?? (r.adjustedInputs ? r.result : null);
              const adj = !!final && (final.totalPoints !== o.totalPoints || final.grade !== o.grade);
              return (
                <tr key={r.id} className="clickable" onClick={() => nav(`/evaluator/evaluations/${r.id}`)}>
                  <td>{r.position.code}</td><td>{r.position.title}</td><td><StatusBadge status={r.status} /></td>
                  <td className="num">{fmt(o.khPoints)}</td><td className="num">{fmt(o.psPoints)}</td><td className="num">{fmt(o.acPoints)}</td>
                  <td className="num"><strong>{fmt(o.totalPoints)}</strong></td><td className="num">{o.grade}</td><td>{o.profile}</td>
                  <td className="num">
                    {adj ? <strong>{fmt(final!.totalPoints)}</strong> : <span className="muted">{r.status === 'approved' ? 'same' : 'pending'}</span>}
                    {r.calibrated && <div className="small muted">calibrated</div>}
                  </td>
                  <td className="num">{adj ? final!.grade : <span className="muted">{r.status === 'approved' ? 'same' : '—'}</span>}</td>
                  <td className="small">{o.checks.join('; ') || 'OK'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={12} className="muted">No completed evaluations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
