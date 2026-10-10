import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_GRADES, evaluate, generateGrades, gradeFor } from '../../../shared/engine';
import { api, type Company, type GradeBand, type GradeStructure, type JobRecord, type Position } from '../api';
import { ErrorAlert, Modal, fmt } from '../components/ui';
import { useData, useStructures } from '../hooks';

type Row = GradeBand & { key: number };
let nextKey = 1;
const withKeys = (g: GradeBand[]): Row[] => g.map((x) => ({ ...x, key: nextKey++ }));
const renumber = (rows: Row[]) => rows.map((r, i) => ({ ...r, grade: i + 1 }));

const SOURCE_LABEL = { position: 'Assigned to position', company: 'Company default', organisation: 'Organisation default' } as const;

export default function GradesPage() {
  const structures = useStructures();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = structures.structures;
  const current = list.find((s) => s.id === selected) ?? list.find((s) => s.isDefault) ?? list[0];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Grade structures</h1>
          <p className="muted">
            Keep separate structures for groups that are graded differently, such as blue and white collar, individual contributors and managers, or each company.
            A job uses the structure assigned to its position, otherwise its company’s default, otherwise the organisation default.
          </p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>+ New structure</button>
      </div>
      <ErrorAlert error={structures.error} />

      <div className="row" style={{ marginBottom: 16, gap: 6 }} role="tablist">
        {list.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === current?.id} className={`choice${s.id === current?.id ? ' on' : ''}`} onClick={() => setSelected(s.id)}>
            {s.name}
            <span className="small" style={{ opacity: 0.8 }}>· {s.bands.length} grades · {s.positionCount} positions{s.isDefault ? ' · default' : ''}</span>
          </button>
        ))}
      </div>

      {current && (
        <StructureEditor
          key={current.id}
          structure={current}
          all={list}
          reload={structures.reload}
          onDeleted={() => setSelected(null)}
        />
      )}

      {creating && (
        <NewStructureModal
          structures={list}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            structures.reload();
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

function NewStructureModal({ structures, onClose, onCreated }: { structures: GradeStructure[]; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState<'standard' | 'copy' | 'generate'>('generate');
  const [copyFrom, setCopyFrom] = useState(structures[0]?.id ?? 0);
  const [gen, setGen] = useState({ count: 10, lowest: 100, highest: 1500 });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      const payload =
        start === 'copy'
          ? { name, description, copyFrom }
          : { name, description, bands: start === 'standard' ? DEFAULT_GRADES : generateGrades(gen.count, gen.lowest, gen.highest) };
      const r = await api.post<{ id: number }>('/grade-structures', payload);
      onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="New grade structure" onClose={onClose}>
      <ErrorAlert error={error} />
      <div className="form-grid">
        <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue collar" /></label>
        <label className="field">Description<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it applies to" /></label>
      </div>
      <div className="field small" style={{ marginTop: 12 }}>Start from</div>
      <div className="row" style={{ gap: 4, marginTop: 4 }}>
        {([['generate', 'Evenly spaced grades'], ['copy', 'Copy of a structure'], ['standard', 'The 23 standard grades']] as const).map(([k, l]) => (
          <button key={k} className={`choice${start === k ? ' on' : ''}`} onClick={() => setStart(k)}>{l}</button>
        ))}
      </div>
      {start === 'copy' && (
        <label className="field" style={{ marginTop: 12 }}>Copy
          <select value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
            {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {start === 'generate' && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field">Number of grades<input type="number" min={3} max={60} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} /></label>
          <label className="field">Grade 2 starts at<input type="number" min={1} value={gen.lowest} onChange={(e) => setGen({ ...gen, lowest: Number(e.target.value) })} /></label>
          <label className="field">Top grade starts at<input type="number" min={2} value={gen.highest} onChange={(e) => setGen({ ...gen, highest: Number(e.target.value) })} /></label>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>You can edit every grade afterwards. A new structure grades no jobs until you assign positions or companies to it.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={submit}>Create</button>
      </div>
    </Modal>
  );
}

function StructureEditor({ structure, all, reload, onDeleted }: { structure: GradeStructure; all: GradeStructure[]; reload: () => void; onDeleted: () => void }) {
  const [tab, setTab] = useState<'grades' | 'applies'>('grades');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      reload();
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>
            {structure.name} {structure.isDefault && <span className="badge b-approved">Organisation default</span>}
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            {structure.description || 'No description.'} · grades {structure.positionCount} position{structure.positionCount === 1 ? '' : 's'}
            {structure.explicitCount ? ` (${structure.explicitCount} assigned directly)` : ''}
          </p>
        </div>
        <div className="row">
          <button onClick={() => {
            const name = prompt('Name', structure.name);
            if (name === null) return;
            const description = prompt('Description', structure.description);
            if (description === null) return;
            act(() => api.patch(`/grade-structures/${structure.id}`, { name: name.trim() || structure.name, description }), 'Saved.');
          }}>Rename</button>
          {!structure.isDefault && (
            <button onClick={() => act(() => api.patch(`/grade-structures/${structure.id}`, { isDefault: true }), `${structure.name} is now the organisation default.`)}>
              Make organisation default
            </button>
          )}
          {!structure.isDefault && (
            <button className="danger" onClick={() => {
              if (!confirm(`Delete ${structure.name}? Its ${structure.positionCount} position(s) will be graded by their company default or the organisation default instead.`)) return;
              act(async () => { await api.del(`/grade-structures/${structure.id}`); onDeleted(); }, 'Structure deleted.');
            }}>Delete</button>
          )}
        </div>
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok" style={{ marginTop: 12 }}>{notice}</div>}

      <div className="tabs" role="tablist" style={{ marginTop: 12 }}>
        <button role="tab" aria-selected={tab === 'grades'} className={tab === 'grades' ? 'on' : ''} onClick={() => setTab('grades')}>Grades</button>
        <button role="tab" aria-selected={tab === 'applies'} className={tab === 'applies' ? 'on' : ''} onClick={() => setTab('applies')}>Applies to</button>
      </div>
      {tab === 'grades' ? (
        <BandsEditor structure={structure} onSaved={() => { reload(); setNotice('Grades saved. Every job on this structure has been re-graded.'); }} />
      ) : (
        <AppliesTo structure={structure} all={all} reload={reload} />
      )}
    </div>
  );
}

function BandsEditor({ structure, onSaved }: { structure: GradeStructure; onSaved: () => void }) {
  const jobs = useData<JobRecord[]>('/jobs');
  const saved = structure.bands;
  const [rows, setRows] = useState<Row[]>(() => withKeys(saved));
  const [gen, setGen] = useState({ count: saved.length || 10, lowest: saved[1]?.minPoints ?? 100, highest: saved[saved.length - 1]?.minPoints ?? 3000 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setRows(withKeys(saved)), [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft: GradeBand[] = rows.map(({ key: _k, ...g }) => g);
  const problems = draft.flatMap((g, i) => {
    const p: string[] = [];
    if (!Number.isFinite(g.minPoints) || g.minPoints < 0) p.push(`Grade ${g.grade}: min points must be 0 or more`);
    if (i > 0 && g.minPoints <= draft[i - 1].minPoints) p.push(`Grade ${g.grade}: min points must be higher than grade ${g.grade - 1}`);
    return p;
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  // Impact of the draft on the scored jobs that use this structure.
  const impact = useMemo(() => {
    const scored = (jobs.data ?? []).filter((j) => j.gradeStructure.id === structure.id && j.result?.complete && j.effectiveInputs);
    if (problems.length || !draft.length) return null;
    let up = 0, down = 0;
    const counts = new Map<number, { before: number; after: number }>();
    for (const j of scored) {
      const after = evaluate(j.effectiveInputs!, draft).grade ?? 0;
      const before = j.result!.grade ?? 0;
      if (after > before) up++;
      if (after < before) down++;
      counts.set(before, { before: (counts.get(before)?.before ?? 0) + 1, after: counts.get(before)?.after ?? 0 });
      counts.set(after, { before: counts.get(after)?.before ?? 0, after: (counts.get(after)?.after ?? 0) + 1 });
    }
    return { scored: scored.length, up, down, counts };
  }, [jobs.data, JSON.stringify(draft), problems.length, structure.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: number, patch: Partial<GradeBand>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/grade-structures/${structure.id}/bands`, draft);
      jobs.reload();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const generate = () => {
    const g = generateGrades(gen.count, gen.lowest, gen.highest);
    // Carry over the career level of the saved band each new boundary falls in; typical roles are left to fill in.
    setRows(withKeys(g.map((x) => ({ ...x, careerLevel: gradeFor(x.minPoints, saved)?.careerLevel ?? '', typicalRoles: '' }))));
  };
  const maxBar = impact ? Math.max(1, ...[...impact.counts.values()].flatMap((c) => [c.before, c.after])) : 1;

  return (
    <div>
      <ErrorAlert error={error} />
      {problems.length > 0 && <div className="alert error">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
        {dirty && <button onClick={() => setRows(withKeys(saved))}>Discard changes</button>}
        <button className="primary" disabled={busy || !dirty || problems.length > 0} onClick={save}>Save grades</button>
      </div>
      <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)' }}>
        <div className="table-wrap">
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
            <h3>Generate evenly spaced grades</h3>
            <p className="small muted">Equal percentage steps between the boundaries. Grade 1 always starts at 0.</p>
            <div className="form-grid">
              <label className="field">Number of grades<input type="number" min={3} max={60} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} /></label>
              <label className="field">Grade 2 starts at<input type="number" min={1} value={gen.lowest} onChange={(e) => setGen({ ...gen, lowest: Number(e.target.value) })} /></label>
              <label className="field">Top grade starts at<input type="number" min={2} value={gen.highest} onChange={(e) => setGen({ ...gen, highest: Number(e.target.value) })} /></label>
            </div>
            <button style={{ marginTop: 12 }} onClick={generate}>Generate (preview)</button>
          </div>

          <div className="card">
            <h3>Impact preview</h3>
            {!impact ? <p className="muted">Fix the errors to see the impact.</p> : impact.scored === 0 ? (
              <p className="muted small">No scored jobs use this structure yet.</p>
            ) : (
              <>
                <p className="small">
                  {impact.scored} scored jobs on this structure · <strong>{impact.up}</strong> move up · <strong>{impact.down}</strong> move down
                  {!dirty && <span className="muted"> (no unsaved changes)</span>}
                </p>
                <div className="legend">
                  <span><i style={{ background: 'var(--series-8)' }} />Saved</span>
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

function AppliesTo({ structure, all, reload }: { structure: GradeStructure; all: GradeStructure[]; reload: () => void }) {
  const companies = useData<Company[]>('/companies');
  const positions = useData<Position[]>('/positions');
  const [companyIds, setCompanyIds] = useState<number[]>(structure.companyIds);
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState('');
  const [companyFilter, setCompanyFilter] = useState(0);
  const [show, setShow] = useState<'all' | 'this' | 'other'>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setCompanyIds(structure.companyIds), [structure.companyIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: number | null | undefined) => all.find((s) => s.id === id)?.name;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      reload();
      companies.reload();
      positions.reload();
      setPicked([]);
      setNotice(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const list = (positions.data ?? []).filter(
    (p) =>
      (!companyFilter || p.companyId === companyFilter) &&
      (show === 'all' || (show === 'this') === (p.gradeStructure.id === structure.id)) &&
      `${p.code} ${p.title} ${p.jobFamily} ${p.departmentName}`.toLowerCase().includes(q.toLowerCase()),
  );
  const companiesDirty = [...companyIds].sort().join(',') !== [...structure.companyIds].sort().join(',');

  return (
    <div className="stack">
      <ErrorAlert error={error ?? companies.error ?? positions.error} />
      {notice && <div className="alert ok">{notice}</div>}

      <div className="card">
        <h3>Company default</h3>
        <p className="small muted">Jobs in these companies use {structure.name} unless their position is assigned to another structure.</p>
        <div className="row" style={{ gap: 4 }}>
          {(companies.data ?? []).map((c) => {
            const on = companyIds.includes(c.id);
            const elsewhere = !on && c.defaultStructureId && c.defaultStructureId !== structure.id ? nameOf(c.defaultStructureId) : null;
            return (
              <button key={c.id} className={`choice${on ? ' on' : ''}`} onClick={() => setCompanyIds(on ? companyIds.filter((x) => x !== c.id) : [...companyIds, c.id])}>
                {c.name}{elsewhere && <span className="small" style={{ opacity: 0.75 }}> (currently on the {elsewhere} structure)</span>}
              </button>
            );
          })}
        </div>
        <button className="primary" style={{ marginTop: 12 }} disabled={!companiesDirty}
          onClick={() => act(() => api.put(`/grade-structures/${structure.id}/companies`, { companyIds }), 'Company defaults saved.')}>
          Save company defaults
        </button>
      </div>

      <div className="card table-wrap">
        <h3>Positions</h3>
        <p className="small muted">
          Assign positions directly, e.g. every blue-collar or every manager role. A direct assignment overrides the company and organisation default.
        </p>
        <div className="row" style={{ marginBottom: 8 }}>
          <input placeholder="Search code, title, job family, department…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <select value={companyFilter} onChange={(e) => setCompanyFilter(Number(e.target.value))}>
            <option value={0}>All companies</option>
            {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="all">All positions</option>
            <option value="this">On {structure.name}</option>
            <option value="other">On other structures</option>
          </select>
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="primary" disabled={!picked.length}
            onClick={() => act(() => api.post('/grade-structures/assign', { positionIds: picked, structureId: structure.id }), `Assigned ${picked.length} position(s) to ${structure.name}.`)}>
            Assign {picked.length || ''} to {structure.name}
          </button>
          <button disabled={!picked.length}
            onClick={() => act(() => api.post('/grade-structures/assign', { positionIds: picked, structureId: null }), `${picked.length} position(s) now follow their company or organisation default.`)}>
            Reset to automatic
          </button>
          <span className="small muted">{picked.length} selected</span>
        </div>
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all" checked={list.length > 0 && list.every((p) => picked.includes(p.id))}
                onChange={(e) => setPicked(e.target.checked ? [...new Set([...picked, ...list.map((p) => p.id)])] : picked.filter((id) => !list.some((p) => p.id === id)))} /></th>
              <th>Code</th><th>Role</th><th>Job family</th><th>Company / department</th><th>Current structure</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /></td>
                <td>{p.code}</td>
                <td>{p.title}</td>
                <td className="small">{p.jobFamily}</td>
                <td className="small">{p.companyName} / {p.departmentName}</td>
                <td>
                  <span className={p.gradeStructure.id === structure.id ? 'badge b-approved' : 'badge b-neutral'}>{p.gradeStructure.name}</span>
                  <div className="small muted">{SOURCE_LABEL[p.gradeStructure.source]}</div>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="muted">No positions match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
