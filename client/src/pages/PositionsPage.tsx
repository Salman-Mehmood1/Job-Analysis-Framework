import { useMemo, useState } from 'react';
import { JD_FILE_ACCEPT, api, extractJdFile, type Company, type Department, type Position } from '../api';
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

const IMPORT_HEADERS = ['code', 'title', 'company', 'department', 'jobFamily', 'jobDescription', 'gradeStructure'];

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
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
      const r = await api.post<{ created: number; skipped: string[] }>('/positions/import', valid);
      onDone(`Imported ${r.created} position${r.created === 1 ? '' : 's'}${r.skipped.length ? `; skipped existing codes ${r.skipped.join(', ')}` : ''}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Import positions from CSV" onClose={onClose}>
      <p className="small muted">Columns: <code>{IMPORT_HEADERS.join(', ')}</code>. Missing companies and departments are created automatically; existing codes are skipped. <code>gradeStructure</code> is optional: the name of an existing structure, or blank for automatic.</p>
      <ErrorAlert error={error} />
      <div className="row" style={{ marginBottom: 8 }}>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <button className="ghost" onClick={() => downloadCsv('positions-template.csv', [IMPORT_HEADERS, ['FIN-01', 'Accounts Assistant', 'Acme Ltd', 'Finance', 'Finance', 'Processes invoices…', '']])}>Download template</button>
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
      <ErrorAlert error={error ?? positions.error} />
      <div className="card table-wrap">
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12, width: 280 }} />
        <table>
          <thead><tr><th>Code</th><th>Role</th><th>Job family</th><th>Company</th><th>Department</th><th>Grade structure</th><th>JD</th><th className="num">Evaluations</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td><td>{p.title}</td><td>{p.jobFamily}</td><td>{p.companyName}</td><td>{p.departmentName}</td>
                <td className="small">{p.gradeStructure.name}{p.gradeStructure.source !== 'position' && <span className="muted"> (auto)</span>}</td>
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
            {!list.length && <tr><td colSpan={9} className="muted">No positions.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <PositionModal initial={editing.form} id={editing.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); positions.reload(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(m) => { setImporting(false); setNotice(m); positions.reload(); }} />}
    </div>
  );
}
