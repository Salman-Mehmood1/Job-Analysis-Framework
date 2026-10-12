import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RESPONDENT_QUESTIONS } from '../../../shared/questionnaire';
import { type Evaluation, RESPONDENT_ROLE_LABEL, type RespondentOverview, type RespondentRequest, api } from '../api';
import { ErrorAlert, downloadCsv, fmtDate } from './ui';
import { useUser } from '../hooks';

const STATUS_TEXT = { invited: 'Not started', in_progress: 'In progress', submitted: 'Submitted' } as const;
const STATUS_CLASS = { invited: 'b-assigned', in_progress: 'b-in_progress', submitted: 'b-approved' } as const;
const USER_ROLE = { admin: 'administrator', management: 'management', evaluator: 'evaluator', respondent: '' } as const;
const TOTAL = RESPONDENT_QUESTIONS.length;

type Show = 'all' | 'open' | 'overdue' | 'submitted';

type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

export const isOverdue = (r: RespondentRequest, today = new Date().toISOString().slice(0, 10)) => r.status !== 'submitted' && !!r.dueDate && r.dueDate < today;

/**
 * What each open questionnaire evaluation of a job still waits for, from the job's requests
 * (mirrors the server rule: a line manager must be asked, and everyone asked must submit).
 */
export function respondentWaits(requests: RespondentRequest[], positionId: number): { text: string; overdue: boolean }[] {
  const mine = requests.filter((r) => r.positionId === positionId);
  const out: { text: string; overdue: boolean }[] = [];
  if (!mine.some((r) => r.role === 'LM')) out.push({ text: 'No line manager asked', overdue: false });
  for (const r of mine.filter((x) => x.status !== 'submitted')) {
    out.push({ text: `${r.role === 'LM' ? 'Line manager' : 'Job holder'} ${r.userName}${r.status === 'invited' ? ' (not started)' : ` (${r.answered}/${TOTAL})`}`, overdue: isOverdue(r) });
  }
  return out;
}

/**
 * Every line manager and job holder request in the organisation (admin manages, management reads).
 * Shown as a tab next to the evaluations that depend on them.
 */
export function RespondentRequestsPanel({
  overview: data,
  evaluations = [],
  linkBase,
  onChanged,
}: {
  overview: Loaded<RespondentOverview>;
  /** Used to link each request to the job's questionnaire evaluations. */
  evaluations?: Evaluation[];
  /** Panel root, e.g. "/admin". */
  linkBase: string;
  onChanged?: () => void;
}) {
  const user = useUser();
  const isAdmin = user.role === 'admin';
  const [show, setShow] = useState<Show>('open');
  const [role, setRole] = useState<'all' | 'LM' | 'JH'>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [due, setDue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const requests = data.data?.requests ?? [];
  const missing = data.data?.missing ?? [];
  const overdue = (r: RespondentRequest) => isOverdue(r, today);
  const evaluationsOf = (positionId: number) => evaluations.filter((e) => e.position.id === positionId && e.method === 'questionnaire');
  const rows = requests.filter(
    (r) =>
      (show === 'all' || (show === 'open' && r.status !== 'submitted') || (show === 'overdue' && overdue(r)) || (show === 'submitted' && r.status === 'submitted')) &&
      (role === 'all' || r.role === role) &&
      `${r.positionCode} ${r.positionTitle} ${r.userName} ${r.companyName} ${r.departmentName}`.toLowerCase().includes(q.toLowerCase()),
  );
  const count = (f: (r: RespondentRequest) => boolean) => requests.filter(f).length;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      data.reload();
      onChanged?.();
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const withDefault = missing.filter((m) => m.defaultLineManager);

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Line managers and job holders asked to answer the questionnaire pack. Questionnaire evaluations can only be submitted once their job’s requests are answered, so chase anyone who has not started or is overdue.
        </p>
        <button onClick={() => downloadCsv('questionnaire-requests.csv', [
          ['Code', 'Job', 'Company', 'Department', 'Role', 'Person', 'Email', 'Status', 'Answered', 'Due', 'Overdue', 'Asked', 'Submitted'],
          ...rows.map((r) => [r.positionCode, r.positionTitle, r.companyName, r.departmentName, RESPONDENT_ROLE_LABEL[r.role], r.userName, r.userEmail,
            STATUS_TEXT[r.status], `${r.answered}/${TOTAL}`, r.dueDate, overdue(r) ? 'Yes' : 'No', r.invitedAt?.slice(0, 10), r.submittedAt?.slice(0, 10)]),
        ])}>Export CSV</button>
      </div>
      <ErrorAlert error={error ?? data.error} />
      {notice && <div className="alert ok">{notice}</div>}

      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="small muted">Requests</div><div className="value">{requests.length}</div></div>
        <div className="kpi"><div className="small muted">Not started</div><div className="value">{count((r) => r.status === 'invited')}</div></div>
        <div className="kpi"><div className="small muted">In progress</div><div className="value">{count((r) => r.status === 'in_progress')}</div></div>
        <div className="kpi"><div className="small muted">Submitted</div><div className="value">{count((r) => r.status === 'submitted')}</div></div>
        <div className="kpi"><div className="small muted">Overdue</div><div className="value" style={{ color: count(overdue) ? 'var(--danger)' : undefined }}>{count(overdue)}</div></div>
        <div className="kpi"><div className="small muted">Jobs without a line manager</div><div className="value" style={{ color: missing.length ? 'var(--warn)' : undefined }}>{missing.length}</div></div>
      </div>

      {missing.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Questionnaire jobs with no line manager asked</h2>
          <p className="small muted">These jobs are being evaluated with the questionnaire, but nobody has been asked as line manager yet.</p>
          <table>
            <thead><tr>{isAdmin && <th />}<th>Job</th><th>Company / department</th><th className="num">Open evaluations</th><th>Position’s line manager</th></tr></thead>
            <tbody>
              {missing.map((m) => (
                <tr key={m.positionId}>
                  {isAdmin && (
                    <td><input type="checkbox" disabled={!m.defaultLineManager} checked={picked.includes(m.positionId)} aria-label={`Select ${m.positionCode}`}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, m.positionId] : picked.filter((x) => x !== m.positionId))} /></td>
                  )}
                  <td><strong>{m.positionCode}</strong> {m.positionTitle}</td>
                  <td className="small">{m.companyName} / {m.departmentName}</td>
                  <td className="num">{m.evaluations}</td>
                  <td>{m.defaultLineManager?.name ?? (isAdmin ? <Link to="/admin/positions">Not set: set it on Positions</Link> : <span className="muted">Not set</span>)}
                    {evaluationsOf(m.positionId).map((e) => (
                      <div key={e.id} className="small"><Link to={`${linkBase}/evaluations/${e.id}`}>Open {e.evaluator?.name ?? 'the'}’s evaluation</Link></div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && withDefault.length > 0 && (
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => setPicked(withDefault.map((m) => m.positionId))}>Select all with a line manager</button>
              <label className="row small">Due date <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <button className="primary" disabled={!picked.length} onClick={() => act(async () => {
                const r = await api.post<{ invited: number; skipped: { name: string; reason: string }[] }>('/questionnaire-responses/invite-defaults', { positionIds: picked, dueDate: due || null, role: 'LM' });
                setPicked([]);
                if (r.skipped.length) setError(r.skipped.map((s) => `${s.name} ${s.reason}`).join('; '));
                return r;
              }, 'Asked the positions’ line managers. Job holders can be asked separately from each evaluation if needed.')}>
                Ask their line managers ({picked.length})
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card table-wrap">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 4 }}>
            {([['open', 'Open'], ['overdue', 'Overdue'], ['submitted', 'Submitted'], ['all', 'All']] as [Show, string][]).map(([k, l]) => (
              <button key={k} className={`choice${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>
            ))}
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="all">Line managers and job holders</option>
            <option value="LM">Line managers</option>
            <option value="JH">Job holders</option>
          </select>
          <input placeholder="Search job, person, company…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        </div>
        <table>
          <thead>
            <tr><th>Job</th><th>Company / department</th><th>Asked as</th><th>Person</th><th>Status</th><th className="num">Answered</th><th>Due</th><th>Asked</th><th>Submitted</th>{isAdmin && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.positionCode}</strong> {r.positionTitle}
                  {!r.questionnaireEvaluations ? (
                    <div className="small muted">No questionnaire evaluation yet</div>
                  ) : (
                    <div className="small">
                      {evaluationsOf(r.positionId).map((e) => (
                        <Link key={e.id} to={`${linkBase}/evaluations/${e.id}`} style={{ marginRight: 8 }}>
                          {e.evaluator?.name ?? 'Evaluation'}’s evaluation
                        </Link>
                      ))}
                    </div>
                  )}
                </td>
                <td className="small">{r.companyName} / {r.departmentName}</td>
                <td>{RESPONDENT_ROLE_LABEL[r.role]}</td>
                <td>{r.userName}{USER_ROLE[r.userRole] && <span className="badge b-neutral" style={{ marginLeft: 6 }}>{USER_ROLE[r.userRole]}</span>}<div className="small muted">{r.userEmail}</div></td>
                <td><span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_TEXT[r.status]}</span></td>
                <td className="num">{r.answered}/{TOTAL}</td>
                <td className={overdue(r) ? 'flag' : ''}>
                  {isAdmin && r.status !== 'submitted' ? (
                    <input type="date" value={r.dueDate ?? ''} aria-label={`Due date for ${r.userName}`}
                      onChange={(e) => act(() => api.patch(`/questionnaire-responses/${r.id}`, { dueDate: e.target.value || null }), `Due date of ${r.userName} for ${r.positionCode} updated.`)} />
                  ) : fmtDate(r.dueDate)}
                  {overdue(r) && <div className="small">overdue</div>}
                </td>
                <td className="small">{fmtDate(r.invitedAt)}</td>
                <td className="small">{fmtDate(r.submittedAt)}</td>
                {isAdmin && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'submitted' && (
                      <button className="ghost" onClick={() => act(() => api.post(`/questionnaire-responses/${r.id}/reopen`), `Reopened ${r.userName}’s questionnaire for ${r.positionCode}.`)}>Reopen</button>
                    )}
                    <button className="ghost danger" onClick={() => confirm(`Remove ${r.userName} from ${r.positionCode}? Their answers are deleted.`) &&
                      act(() => api.del(`/questionnaire-responses/${r.id}`), `Removed ${r.userName} from ${r.positionCode}.`)}>Remove</button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && !data.loading && <tr><td colSpan={10} className="muted">No requests match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
