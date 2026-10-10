import { type FormEvent, useState } from 'react';
import { api, type OrgUser, type Role } from '../api';
import { ErrorAlert } from '../components/ui';
import { useData, useUser } from '../hooks';

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', evaluator: 'Evaluator', management: 'Management', respondent: 'Job holder / line manager' };

export default function UsersPage() {
  const me = useUser();
  const users = useData<OrgUser[]>('/users');
  const [f, setF] = useState({ name: '', email: '', role: 'evaluator' as Role, password: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      users.reload();
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    act(() => api.post('/users', f).then(() => setF({ name: '', email: '', role: 'evaluator', password: '' })), `Added ${f.name}. Share their email and temporary password with them.`);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="muted">Who can sign in, and which panel they see.</p>
        </div>
      </div>
      <ErrorAlert error={error ?? users.error} />
      {notice && <div className="alert ok">{notice}</div>}
      <div className="card">
        <h2>Add a user</h2>
        <form onSubmit={create}>
          <div className="form-grid">
            <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></label>
            <label className="field">Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
            <label className="field">Role
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label className="field">Temporary password<input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} /></label>
          </div>
          <button className="primary" style={{ marginTop: 12 }}>Add user</button>
        </form>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="num">Assigned</th><th className="num">Completed</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                <td>{u.name}{u.id === me.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => act(() => api.patch(`/users/${u.id}`, { role: e.target.value }), 'Role updated.')}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td className="num">{u.role === 'evaluator' ? u.assigned : ''}</td>
                <td className="num">{u.role === 'evaluator' ? u.completed : ''}</td>
                <td>{u.active ? 'Active' : 'Deactivated'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="ghost" onClick={() => {
                    const p = prompt(`New temporary password for ${u.name} (8+ characters)`);
                    if (p) act(() => api.patch(`/users/${u.id}`, { password: p }), 'Password reset.');
                  }}>Reset password</button>
                  {u.id !== me.id && (
                    <button className="ghost" onClick={() => act(() => api.patch(`/users/${u.id}`, { active: !u.active }), u.active ? 'User deactivated.' : 'User reactivated.')}>
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
