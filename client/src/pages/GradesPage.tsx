import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_GRADES, evaluate, generateGrades, gradeFor } from '../../../shared/engine';
import { api, type Evaluation, type GradeBand } from '../api';
import { ErrorAlert, fmt } from '../components/ui';
import { useData } from '../hooks';

type Row = GradeBand & { key: number };
let nextKey = 1;
const withKeys = (g: GradeBand[]): Row[] => g.map((x) => ({ ...x, key: nextKey++ }));
const renumber = (rows: Row[]) => rows.map((r, i) => ({ ...r, grade: i + 1 }));

export default function GradesPage() {
  const grades = useData<{ grades: GradeBand[] }>('/grades');
  const evals = useData<Evaluation[]>('/evaluations');
  const [rows, setRows] = useState<Row[]>([]);
  const [gen, setGen] = useState({ count: 15, lowest: 100, highest: 3000 });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (grades.data) setRows(withKeys(grades.data.grades));
  }, [grades.data]);

  const saved = grades.data?.grades ?? [];
  const draft: GradeBand[] = rows.map(({ key: _k, ...g }) => g);
  const problems = draft.flatMap((g, i) => {
    const p: string[] = [];
    if (!Number.isFinite(g.minPoints) || g.minPoints < 0) p.push(`Grade ${g.grade}: min points must be 0 or more`);
    if (i > 0 && g.minPoints <= draft[i - 1].minPoints) p.push(`Grade ${g.grade}: min points must be higher than grade ${g.grade - 1}`);
    return p;
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  // Impact of the draft structure on every scored evaluation.
  const impact = useMemo(() => {
    const scored = (evals.data ?? []).filter((e) => e.result?.complete);
    if (problems.length || !draft.length) return null;
    let up = 0, down = 0;
    const counts = new Map<number, { before: number; after: number }>();
    for (const e of scored) {
      const inputs = e.adjustedInputs ?? e.inputs!;
      const after = evaluate(inputs, draft).grade ?? 0;
      const before = e.result!.grade ?? 0;
      if (after > before) up++;
      if (after < before) down++;
      counts.set(before, { before: (counts.get(before)?.before ?? 0) + 1, after: counts.get(before)?.after ?? 0 });
      counts.set(after, { before: counts.get(after)?.before ?? 0, after: (counts.get(after)?.after ?? 0) + 1 });
    }
    return { scored: scored.length, up, down, counts };
  }, [evals.data, JSON.stringify(draft), problems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: number, patch: Partial<GradeBand>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.put('/grades', draft);
      grades.reload();
      evals.reload();
      setNotice('Grade structure saved. Every evaluation has been re-graded.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    const g = generateGrades(gen.count, gen.lowest, gen.highest);
    // Carry over the career level of the saved band each new boundary falls in; typical roles are left for you to fill.
    setRows(withKeys(g.map((x) => ({ ...x, careerLevel: gradeFor(x.minPoints, saved)?.careerLevel ?? '', typicalRoles: '' }))));
  };

  const maxBar = impact ? Math.max(1, ...[...impact.counts.values()].flatMap((c) => [c.before, c.after])) : 1;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Grade structure</h1>
          <p className="muted">Set how many grades there are and the points range of each. Changes re-grade every evaluation as soon as you save.</p>
        </div>
        <div className="row">
          {dirty && <button onClick={() => setRows(withKeys(saved))}>Discard changes</button>}
          <button className="primary" disabled={busy || !dirty || problems.length > 0} onClick={save}>Save structure</button>
        </div>
      </div>
      <ErrorAlert error={error ?? grades.error} />
      {notice && <div className="alert ok">{notice}</div>}
      {problems.length > 0 && <div className="alert error">{problems.map((p) => <div key={p}>{p}</div>)}</div>}

      <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)' }}>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Grade</th><th>Min points</th><th>Max points</th><th>Career level</th><th>Typical roles</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td><strong>{r.grade}</strong></td>
                  <td>
                    <input type="number" min={0} value={r.minPoints} style={{ width: 90 }} disabled={i === 0}
                      title={i === 0 ? 'The lowest grade always starts at 0 so every score is graded' : ''}
                      onChange={(e) => update(r.key, { minPoints: Number(e.target.value) })} />
                  </td>
                  <td className="num muted">{i < rows.length - 1 ? fmt(rows[i + 1].minPoints - 1) : 'and above'}</td>
                  <td><input value={r.careerLevel} onChange={(e) => update(r.key, { careerLevel: e.target.value })} /></td>
                  <td><input value={r.typicalRoles} onChange={(e) => update(r.key, { typicalRoles: e.target.value })} /></td>
                  <td>
                    <button className="ghost danger" disabled={rows.length <= 2 || i === 0} aria-label={`Remove grade ${r.grade}`}
                      onClick={() => setRows((rs) => renumber(rs.filter((x) => x.key !== r.key)))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => {
              const last = rows[rows.length - 1];
              setRows((rs) => renumber([...rs, { key: nextKey++, grade: 0, minPoints: Math.round((last?.minPoints || 100) * 1.2), careerLevel: '', typicalRoles: '' }]));
            }}>+ Add grade at top</button>
            <button onClick={() => setRows(withKeys(DEFAULT_GRADES))}>Reset to the 23 standard grades</button>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Generate a structure</h2>
            <p className="small muted">Creates evenly progressing bands (equal percentage steps) between the lowest and highest boundaries. Grade 1 always starts at 0.</p>
            <div className="form-grid">
              <label className="field">Number of grades<input type="number" min={3} max={60} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} /></label>
              <label className="field">Grade 2 starts at<input type="number" min={1} value={gen.lowest} onChange={(e) => setGen({ ...gen, lowest: Number(e.target.value) })} /></label>
              <label className="field">Top grade starts at<input type="number" min={2} value={gen.highest} onChange={(e) => setGen({ ...gen, highest: Number(e.target.value) })} /></label>
            </div>
            <button style={{ marginTop: 12 }} onClick={generate}>Generate (preview)</button>
          </div>

          <div className="card">
            <h2>Impact preview</h2>
            {!impact ? <p className="muted">Fix the errors to see the impact.</p> : (
              <>
                <p className="small">
                  {impact.scored} scored evaluations · <strong>{impact.up}</strong> move up · <strong>{impact.down}</strong> move down
                  {!dirty && <span className="muted"> (no unsaved changes)</span>}
                </p>
                <div className="legend">
                  <span><i style={{ background: 'var(--series-8)' }} />Saved structure</span>
                  <span><i style={{ background: 'var(--series-1)' }} />Draft</span>
                </div>
                <table>
                  <thead><tr><th>Grade</th><th>Jobs</th><th className="num">Saved</th><th className="num">Draft</th></tr></thead>
                  <tbody>
                    {[...impact.counts.entries()].sort((a, b) => b[0] - a[0]).map(([g, c]) => (
                      <tr key={g}>
                        <td>{g || 'Ungraded'}</td>
                        <td style={{ width: '50%' }}>
                          <div className="bar-track" style={{ maxWidth: 'none', marginBottom: 2 }}><div className="bar-fill" style={{ width: `${(c.before / maxBar) * 100}%`, background: 'var(--series-8)' }} /></div>
                          <div className="bar-track" style={{ maxWidth: 'none' }}><div className="bar-fill" style={{ width: `${(c.after / maxBar) * 100}%` }} /></div>
                        </td>
                        <td className="num">{c.before}</td>
                        <td className="num">{c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
