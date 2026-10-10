import { useEffect, useState } from 'react';
import { api, type Company, type Department } from '../api';
import { ErrorAlert } from '../components/ui';
import { useAuth, useData } from '../hooks';

export default function OrganizationPage() {
  const { organization, setSession, user } = useAuth();
  const companies = useData<Company[]>('/companies');
  const departments = useData<Department[]>('/departments');
  const [orgName, setOrgName] = useState(organization?.name ?? '');
  const [currencyNote, setCurrencyNote] = useState(organization?.currencyNote ?? '');
  const [newCompany, setNewCompany] = useState('');
  const [newDept, setNewDept] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setOrgName(organization?.name ?? '');
    setCurrencyNote(organization?.currencyNote ?? '');
  }, [organization]);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      companies.reload();
      departments.reload();
      if (msg) setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = (kind: 'companies' | 'departments', id: number, current: string) => {
    const name = prompt('New name', current);
    if (name && name.trim() && name !== current) act(() => api.patch(`/${kind}/${id}`, { name: name.trim() }));
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Companies &amp; departments</h1>
          <p className="muted">The structure positions belong to. Used by the company and department slicers.</p>
        </div>
      </div>
      <ErrorAlert error={error ?? companies.error} />
      {notice && <div className="alert ok">{notice}</div>}

      <div className="card">
        <h2>Organisation</h2>
        <div className="form-grid">
          <label className="field">Name<input value={orgName} onChange={(e) => setOrgName(e.target.value)} /></label>
          <label className="field">Magnitude currency note<input value={currencyNote} onChange={(e) => setCurrencyNote(e.target.value)} /></label>
        </div>
        <button style={{ marginTop: 12 }} onClick={() => act(async () => {
          await api.patch('/organization', { name: orgName, currencyNote });
          if (user && organization) setSession({ user, organization: { ...organization, name: orgName, currencyNote } });
        }, 'Organisation updated.')}>Save</button>
      </div>

      <div className="card">
        <h2>Companies</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (newCompany.trim()) act(() => api.post('/companies', { name: newCompany.trim() }).then(() => setNewCompany(''))); }}>
          <input placeholder="New company name" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />
          <button className="primary" disabled={!newCompany.trim()}>Add company</button>
        </form>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {(companies.data ?? []).map((c) => {
          const depts = (departments.data ?? []).filter((d) => d.companyId === c.id);
          return (
            <div className="card" key={c.id}>
              <div className="row spread">
                <h2>{c.name}</h2>
                <div className="row">
                  <button className="ghost" onClick={() => rename('companies', c.id, c.name)}>Rename</button>
                  <button className="ghost danger" onClick={() => confirm(`Delete ${c.name}?`) && act(() => api.del(`/companies/${c.id}`))}>Delete</button>
                </div>
              </div>
              <table>
                <tbody>
                  {depts.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="ghost" onClick={() => rename('departments', d.id, d.name)}>Rename</button>
                        <button className="ghost danger" onClick={() => confirm(`Delete ${d.name}?`) && act(() => api.del(`/departments/${d.id}`))}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!depts.length && <tr><td className="muted">No departments yet.</td></tr>}
                </tbody>
              </table>
              <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => {
                e.preventDefault();
                const name = newDept[c.id]?.trim();
                if (name) act(() => api.post('/departments', { name, companyId: c.id }).then(() => setNewDept({ ...newDept, [c.id]: '' })));
              }}>
                <input placeholder="New department" value={newDept[c.id] ?? ''} onChange={(e) => setNewDept({ ...newDept, [c.id]: e.target.value })} />
                <button disabled={!newDept[c.id]?.trim()}>Add</button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
