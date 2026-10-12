import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Evaluation, type JobRecord, type RespondentOverview } from '../api';
import { RespondentRequestsPanel, isOverdue } from '../components/RespondentRequests';
import { JobBadges, rangeFlag, spreadFlag } from '../components/JobBits';
import { type Filters, SlicerBar, applyFilters } from '../components/Slicers';
import { ErrorAlert, StatusBadge, fmt, fmtDate } from '../components/ui';
import { useData } from '../hooks';

export default function ReviewQueuePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'calibration' ? 'calibration' : params.get('tab') === 'requests' ? 'requests' : 'single';
  const overview = useData<RespondentOverview>('/questionnaire-responses/overview');
  const allEvals = useData<Evaluation[]>('/evaluations');
  const requests = overview.data?.requests ?? [];
  const openRequests = requests.filter((r) => r.status !== 'submitted').length;
  const overdueRequests = requests.filter((r) => isOverdue(r)).length;
  const jobs = useData<JobRecord[]>('/jobs');
  const ready = (jobs.data ?? []).filter((j) => j.mode === 'multi' && j.status === 'submitted').length;
  const single = (allEvals.data ?? []).filter((e) => (e.raterCount ?? 1) === 1 && e.status === 'submitted').length;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Review &amp; calibration</h1>
          <p className="muted">Jobs with one evaluator are reviewed evaluation by evaluation. Jobs with several evaluators are calibrated: their scores are combined into a consensus you can adjust and approve.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'single'} className={tab === 'single' ? 'on' : ''} onClick={() => setParams({})}>Single-evaluator reviews ({single})</button>
        <button role="tab" aria-selected={tab === 'calibration'} className={tab === 'calibration' ? 'on' : ''} onClick={() => setParams({ tab: 'calibration' })}>Calibration ({ready} ready)</button>
        <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'on' : ''} onClick={() => setParams({ tab: 'requests' })}>
          Questionnaire requests ({openRequests} open{overdueRequests ? `, ${overdueRequests} overdue` : ''})
        </button>
      </div>
      {tab === 'single' && <SingleQueue />}
      {tab === 'calibration' && <CalibrationQueue jobs={jobs.data ?? []} error={jobs.error} />}
      {tab === 'requests' && <RespondentRequestsPanel overview={overview} evaluations={allEvals.data ?? []} linkBase="/management" />}
    </div>
  );
}

function CalibrationQueue({ jobs, error }: { jobs: JobRecord[]; error: string | null }) {
  const nav = useNavigate();
  const [filters, setFilters] = useState<Filters>({ status: ['submitted'] });
  const multi = jobs.filter((j) => j.mode === 'multi');
  const rows = useMemo(() => applyFilters(multi, filters), [multi, filters]);
  return (
    <div>
      <ErrorAlert error={error} />
      <SlicerBar rows={multi} filters={filters} onChange={setFilters} dims={['status', 'company', 'department', 'role', 'grade', 'evaluator']} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Role</th><th>Company / department</th><th>Submitted</th><th className="num">Evaluator range</th>
              <th className="num">Grades</th><th>Status</th><th className="num">Agreed pts</th><th className="num">Grade</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => nav(`/management/jobs/${j.id}`)}>
                <td>{j.position.code}</td>
                <td>{j.position.title}<JobBadges j={j} /></td>
                <td className="small">{j.company.name} / {j.department.name}</td>
                <td>{j.completeCount} of {j.evaluationCount}</td>
                <td className="num">{j.spread ? `${fmt(j.spread.minPoints)}–${fmt(j.spread.maxPoints)}` : '—'}</td>
                <td className="num">{j.spread ? (j.spread.minGrade === j.spread.maxGrade ? j.spread.minGrade : `${j.spread.minGrade}–${j.spread.maxGrade}`) : '—'}</td>
                <td><StatusBadge status={j.status} /></td>
                <td className="num">{fmt(j.result?.totalPoints)}</td>
                <td className="num">{j.result?.grade ?? '—'}</td>
                <td className="small"><span className="flag">{[spreadFlag(j), rangeFlag(j)].filter(Boolean).join('; ')}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="muted">No jobs match. Clear the status slicer to see every multi-evaluator job.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SingleQueue() {
  const nav = useNavigate();
  const evals = useData<Evaluation[]>('/evaluations');
  const [filters, setFilters] = useState<Filters>({ status: ['submitted'] });
  const [picked, setPicked] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const singles = useMemo(() => (evals.data ?? []).filter((e) => (e.raterCount ?? 1) === 1), [evals.data]);
  const rows = useMemo(() => applyFilters(singles, filters), [singles, filters]);
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
      <div className="row spread" style={{ marginBottom: 12 }}>
        <span className="muted">Open an evaluation to adjust levels, approve or return it.</span>
        <button className="primary" disabled={!picked.length} onClick={bulkApprove}>Approve selected ({picked.length})</button>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      <ErrorAlert error={error ?? evals.error} />
      <SlicerBar rows={singles} filters={filters} onChange={setFilters} dims={['status', 'company', 'department', 'role', 'grade', 'evaluator']} />
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
