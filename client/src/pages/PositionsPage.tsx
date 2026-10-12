import { useMemo, useState } from 'react';
import { JD_FILE_ACCEPT, api, extractJdFile, type Company, type Department, type OrgUser, type Position } from '../api';
import { type PeopleChoice, PeoplePicker, peopleOfPosition } from '../components/PeoplePicker';
import { ErrorAlert, Modal, downloadCsv, parseCsv } from '../components/ui';
import { useData, useStructures } from '../hooks';

type Form = { code: string; title: string; jobFamily: string; jobDescription: string; companyId: number; departmentId: number; gradeStructureId: number | null };
const EMPTY: Form = { code: '', title: '', jobFamily: '', jobDescription: '', companyId: 0, departmentId: 0, gradeStructureId: null };

function PositionModal({ initial, id, onClose, onSaved }: { initial: Form; id?: number; onClose: () => void; onSaved: () => void }) {
  const companies = useData<Company[]>('/companies');
  const departments = useData<Department[]>('/departments');
  const { structures } = useStructures();
  const [f, setF] = useState(initial);
  const company = (companies.data ?? []).find((c) => c.id === f.companyId);
  const automatic = structures.find((s) => s.id === company?.defaultStructureId) ?? structures.find((s) => s.isDefault);
  const [error, setError] = useState<string | null>(null);
  const depts = (departments.data ?? []).filter((d) => d.companyId === f.companyId);
  const save = async () => {
    try {
      if (id) await api.patch(`/positions/${id}`, f);
      else await api.post('/positions', f);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={id ? 'Edit position' : 'New position'} onClose={onClose}>
      <ErrorAlert error={error} />
      {!companies.data?.length && <div className="alert warn">Add a company and department first (Companies &amp; departments).</div>}
      <div className="form-grid">
        <label className="field">Code<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="FIN-01" /></label>
        <label className="field">Role / title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Job family<input value={f.jobFamily} onChange={(e) => setF({ ...f, jobFamily: e.target.value })} /></label>
        <label className="field">Company
          <select value={f.companyId} onChange={(e) => setF({ ...f, companyId: Number(e.target.value), departmentId: 0 })}>
            <option value={0}>Choose…</option>
            {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">Department
          <select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: Number(e.target.value) })} disabled={!f.companyId}>
            <option value={0}>Choose…</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="field">Grade structure
          <select value={f.gradeStructureId ?? ''} onChange={(e) => setF({ ...f, gradeStructureId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Automatic{automatic ? ` (${automatic.name})` : ''}</option>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="field">Job description</span>
        <label className="small">Load from file (Word, PDF or text){' '}
          <input type="file" accept={JD_FILE_ACCEPT} onChange={async (e) => {
            const input = e.target;
            const file = input.files?.[0];
            if (!file) return;
            try {
              const r = await extractJdFile(file);
              setF((cur) => ({ ...cur, jobDescription: r.text }));
              setError(null);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              input.value = '';
            }
          }} />
        </label>
      </div>
      <textarea rows={8} value={f.jobDescription} onChange={(e) => setF({ ...f, jobDescription: e.target.value })} style={{ marginTop: 4 }} />
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!f.code || !f.title || !f.companyId || !f.departmentId} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

const IMPORT_HEADERS = ['code', 'title', 'company', 'department', 'jobFamily', 'jobDescription', 'gradeStructure', 'lineManagerEmail', 'lineManagerName', 'jobHolderEmails', 'jobHolderNames'];
type CreatedUser = { name: string; email: string; password: string };

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string, createdUsers: CreatedUser[]) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => {
    const parsed = parseCsv(text.trim());
    if (!parsed.length) return [];
    const head = parsed[0].map((h) => h.trim().replace(/\s+/g, '').toLowerCase());
    const idx = (k: string) => head.indexOf(k.toLowerCase());
    return parsed.slice(1).map((r) => Object.fromEntries(IMPORT_HEADERS.map((k) => [k, (r[idx(k)] ?? '').trim()])));
  }, [text]);
  const valid = rows.filter((r) => r.code && r.title && r.company && r.department);

  const submit = async () => {
    try {
      const r = await api.post<{ created: number; skipped: string[]; peopleSet: number; createdUsers: CreatedUser[] }>('/positions/import', valid);
      onDone(
        `Imported ${r.created} position${r.created === 1 ? '' : 's'}${r.skipped.length ? `; existing codes kept as they are: ${r.skipped.join(', ')}` : ''}.` +
          (r.peopleSet ? ` Set the line manager / job holders of ${r.peopleSet} position${r.peopleSet === 1 ? '' : 's'}.` : ''),
        r.createdUsers,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Import positions from CSV" onClose={onClose} wide>
      <p className="small muted">Columns: <code>{IMPORT_HEADERS.join(', ')}</code>. Missing companies and departments are created automatically; existing codes are not changed. <code>gradeStructure</code> is optional: the name of an existing structure, or blank for automatic.</p>
      <p className="small muted">
        Line manager and job holders are optional and also update existing positions. Several job holders are separated with <code>;</code>, with their names in the same order.
        An email with no account yet gets a new “Job holder / line manager” account when its name is given; you get their first passwords to pass on.
      </p>
      <ErrorAlert error={error} />
      <div className="row" style={{ marginBottom: 8 }}>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <button className="ghost" onClick={() => downloadCsv('positions-template.csv', [IMPORT_HEADERS, ['FIN-01', 'Accounts Assistant', 'Acme Ltd', 'Finance', 'Finance', 'Processes invoices…', '', 'nadia@acme.com', 'Nadia Shah', 'ali@acme.com;sana@acme.com', 'Ali Khan;Sana Iqbal']])}>Download template</button>
      </div>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste CSV here" />
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="small muted">{valid.length} valid row{valid.length === 1 ? '' : 's'}{rows.length > valid.length ? `, ${rows.length - valid.length} missing required fields` : ''}</span>
        <button className="primary" disabled={!valid.length} onClick={submit}>Import</button>
      </div>
    </Modal>
  );
}

export default function PositionsPage() {
  const positions = useData<Position[]>('/positions');
  const [editing, setEditing] = useState<{ form: Form; id?: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peopleFor, setPeopleFor] = useState<Position | null>(null);
  const [createdUsers, setCreatedUsers] = useState<CreatedUser[]>([]);
  const list = (positions.data ?? []).filter((p) => `${p.code} ${p.title} ${p.jobFamily} ${p.companyName} ${p.departmentName}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Positions</h1>
          <p className="muted">The jobs to be evaluated, with their job descriptions.</p>
        </div>
        <div className="row">
          <button onClick={() => setImporting(true)}>Import CSV</button>
          <button className="primary" onClick={() => setEditing({ form: EMPTY })}>+ New position</button>
        </div>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      {createdUsers.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row spread">
            <h3 style={{ margin: 0 }}>New job holder / line manager accounts</h3>
            <div className="row">
              <button onClick={() => downloadCsv('new-accounts.csv', [['name', 'email', 'password'], ...createdUsers.map((u) => [u.name, u.email, u.password])])}>Download</button>
              <button className="ghost" onClick={() => setCreatedUsers([])}>Dismiss</button>
            </div>
          </div>
          <p className="small muted">Pass each person their first password; it is shown only now. They can change it after signing in.</p>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Password</th></tr></thead>
            <tbody>{createdUsers.map((u) => <tr key={u.email}><td>{u.name}</td><td>{u.email}</td><td><code>{u.password}</code></td></tr>)}</tbody>
          </table>
        </div>
      )}
      <ErrorAlert error={error ?? positions.error} />
      <div className="card table-wrap">
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12, width: 280 }} />
        <table>
          <thead><tr><th>Code</th><th>Role</th><th>Job family</th><th>Company</th><th>Department</th><th>Grade structure</th><th>Line manager · job holders</th><th>JD</th><th className="num">Evaluations</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td><td>{p.title}</td><td>{p.jobFamily}</td><td>{p.companyName}</td><td>{p.departmentName}</td>
                <td className="small">{p.gradeStructure.name}{p.gradeStructure.source !== 'position' && <span className="muted"> (auto)</span>}</td>
                <td className="small">
                  <button className="ghost" style={{ textAlign: 'left' }} onClick={() => setPeopleFor(p)} title="Set line manager and job holders">
                    {p.lineManager || p.jobHolders.length ? (
                      <>
                        {p.lineManager ? p.lineManager.name : <span className="muted">No line manager</span>}
                        {p.jobHolders.length > 0 && <span className="muted"> · {p.jobHolders.map((j) => j.name).join(', ')}</span>}
                      </>
                    ) : <span className="muted">Set…</span>}
                  </button>
                </td>
                <td className="small muted">{p.jobDescription ? `${p.jobDescription.trim().split(/\s+/).length} words` : '—'}</td>
                <td className="num">{p.evaluations}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="ghost" onClick={() => setEditing({ id: p.id, form: { code: p.code, title: p.title, jobFamily: p.jobFamily, jobDescription: p.jobDescription, companyId: p.companyId, departmentId: p.departmentId, gradeStructureId: p.gradeStructureId } })}>Edit</button>
                  <button className="ghost danger" onClick={async () => {
                    if (!confirm(`Delete ${p.code}${p.evaluations ? ` and its ${p.evaluations} evaluation(s)` : ''}?`)) return;
                    try { await api.del(`/positions/${p.id}`); positions.reload(); } catch (e) { setError((e as Error).message); }
                  }}>Delete</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={10} className="muted">No positions.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <PositionModal initial={editing.form} id={editing.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); positions.reload(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(m, users) => { setImporting(false); setNotice(m); setCreatedUsers(users); positions.reload(); }} />}
      {peopleFor && <PeopleModal position={peopleFor} onClose={() => setPeopleFor(null)} onSaved={() => { setPeopleFor(null); setNotice(`Saved the line manager and job holders of ${peopleFor.code}.`); positions.reload(); }} />}
    </div>
  );
}

/** Default line manager and job holders of a position. */
function PeopleModal({ position, onClose, onSaved }: { position: Position; onClose: () => void; onSaved: () => void }) {
  const users = useData<OrgUser[]>('/users');
  const [value, setValue] = useState<PeopleChoice>(peopleOfPosition(position));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.put(`/positions/${position.id}/people`, value);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={`${position.code} · ${position.title}`} onClose={onClose}>
      <p className="small muted">
        Who answers this job’s questionnaire. They are asked automatically when a questionnaire evaluation of the job is assigned.
        Anyone in the organisation can be chosen, except people who evaluate this job.
      </p>
      <ErrorAlert error={error ?? users.error} />
      <PeoplePicker users={users.data ?? []} value={value} onChange={setValue} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
