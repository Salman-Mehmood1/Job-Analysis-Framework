import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Organization, type User } from '../api';
import { ErrorAlert } from '../components/ui';
import { useAuth } from '../hooks';

type Session = { user: User; organization: Organization };

const DEMO = [
  ['Administrator', 'admin@demo.com'],
  ['Management', 'management@demo.com'],
  ['Evaluator · Sara', 'evaluator@demo.com'],
  ['Evaluator · Bilal', 'evaluator2@demo.com'],
  ['Evaluator · Zainab', 'evaluator3@demo.com'],
  ['Line manager · Kamran', 'kamran@demo.com'],
  ['Job holder · Hina', 'hina@demo.com'],
  ['Line manager · Farah', 'farah@demo.com'],
  ['Job holder · Usman', 'usman@demo.com'],
  ['Line manager · Tariq', 'tariq@demo.com'],
] as const;

export function LoginPage() {
  const { setSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await api.post<Session>('/auth/login', { email: e, password: p }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    signIn(email, password);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="card">
          <h1>Job Evaluation</h1>
          <p className="muted">Sign in as an administrator, evaluator or management reviewer.</p>
          <ErrorAlert error={error} />
          <form onSubmit={submit} className="stack">
            <label className="field">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
            <label className="field">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
            <button className="primary" disabled={busy}>Sign in</button>
          </form>
          <p className="small muted" style={{ marginTop: 16 }}>
            New organisation? <Link to="/register">Create an account</Link>
          </p>
        </div>
        <div className="card demo-logins">
          <h3>Demo accounts</h3>
          <p className="small muted">Password <code>demo1234</code>. Available while the demo organisation exists.</p>
          {DEMO.map(([label, em]) => (
            <button key={em} onClick={() => signIn(em, 'demo1234')} disabled={busy}>
              <span>{label}</span><span className="muted small">{em}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { setSession } = useAuth();
  const [f, setF] = useState({ organization: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api.post<Session>('/auth/register', f));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <label className="field">{label}<input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required minLength={k === 'password' ? 8 : 2} /></label>
  );

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <h1>Create an organisation</h1>
        <p className="muted">You become its administrator and can then add evaluators and management users.</p>
        <ErrorAlert error={error} />
        <form onSubmit={submit} className="stack">
          {field('organization', 'Organisation name')}
          {field('name', 'Your name')}
          {field('email', 'Email', 'email')}
          {field('password', 'Password (8+ characters)', 'password')}
          <button className="primary" disabled={busy}>Create organisation</button>
        </form>
        <p className="small muted" style={{ marginTop: 16 }}><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
