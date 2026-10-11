/**
 * Salary bands, cadres and pay inputs of a grade structure (Grading & Rewards Framework).
 * PayStarter sets up bands for a structure from a few inputs; PayEditor edits every detail.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { GradeBand } from '../../../shared/engine';
import {
  type CadreInput,
  EMPTY_CADRE,
  type PayModel,
  type PayTable,
  RETIREMENT_SCHEMES,
  computePay,
  coverageProblems,
  generatePayBands,
  minimumWage,
  payModelFor,
  placeSalary,
} from '../../../shared/pay';
import { api, type GradeStructure, type JobRecord } from '../api';
import { useData } from '../hooks';
import { ErrorAlert, fmt } from './ui';

const pct = (n: number | null | undefined, digits = 0) => (n == null ? '—' : `${(n * 100).toFixed(digits)}%`);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function PctInput({ value, onChange, width = 70, disabled, placeholder }: { value: number | null; onChange: (v: number | null) => void; width?: number; disabled?: boolean; placeholder?: string }) {
  return (
    <span className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
      <input type="number" step="0.5" style={{ width }} disabled={disabled} placeholder={placeholder}
        value={value == null ? '' : Math.round(value * 10000) / 100}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value) / 100)} />
      <span className="small muted">%</span>
    </span>
  );
}
function NumInput({ value, onChange, width = 110, min = 0, disabled }: { value: number; onChange: (v: number) => void; width?: number; min?: number; disabled?: boolean }) {
  return <input type="number" min={min} style={{ width }} disabled={disabled} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

// ===================================================================== starter

export interface StarterOptions {
  mode: 'none' | 'framework' | 'copy';
  copyFrom: number;
  bandCount: number;
  currency: string;
  region: string;
  anchor: number;
  lift: boolean;
  overlap: number;
  spreads: [number, number, number];
}

/** Builds a pay model for `grades` from the starter inputs. */
export function buildStarterModel(grades: GradeBand[], o: StarterOptions, structures: GradeStructure[]): PayModel | null {
  if (o.mode === 'none' || grades.length < 1) return null;
  if (o.mode === 'copy') {
    const src = structures.find((s) => s.id === o.copyFrom)?.pay;
    if (!src) return null;
    const m = clone(src);
    if (coverageProblems(m, grades).some((p) => /grade|start|end/.test(p))) {
      // Different grades: keep the inputs and cadres, regroup the bands to fit.
      const ladder = [...m.bands].sort((a, b) => a.gradeFrom - b.gradeFrom).map((b) => b.cadre);
      m.bands = generatePayBands(grades, Math.min(m.bands.length, grades.length), {
        tiers: m.tiers.map((t) => t.name),
        cadreNames: ladder,
        rounding: m.bands[0]?.rounding ?? 5000,
      });
    }
    return m;
  }
  const m = payModelFor(grades, o.bandCount);
  m.currency = o.currency || m.currency;
  m.region = o.region;
  m.anchor = o.anchor;
  m.liftToMinimumWage = o.lift;
  m.overlap = o.overlap;
  m.tiers = m.tiers.map((t, i) => ({ ...t, spread: o.spreads[i] ?? t.spread }));
  return m;
}

export function defaultStarter(grades: GradeBand[], structures: GradeStructure[]): StarterOptions {
  return {
    mode: 'framework',
    copyFrom: structures.find((s) => s.pay)?.id ?? 0,
    bandCount: grades.length === 23 ? 11 : Math.max(1, Math.round(grades.length / 2)),
    currency: 'PKR',
    region: 'Punjab',
    anchor: 36000,
    lift: true,
    overlap: 0.1,
    spreads: [0.4, 0.5, 0.6],
  };
}

/** A few inputs that set up salary bands for a structure, with a live preview. */
export function PayStarter({ grades, structures, value, onChange, allowNone = true }: {
  grades: GradeBand[];
  structures: GradeStructure[];
  value: StarterOptions;
  onChange: (o: StarterOptions) => void;
  allowNone?: boolean;
}) {
  const withPay = structures.filter((s) => s.pay);
  const model = buildStarterModel(grades, value, structures);
  const table = model ? computePay(model, grades) : null;
  const set = (p: Partial<StarterOptions>) => onChange({ ...value, ...p });
  const regions = payModelFor(grades).minimumWages;
  const modes: [StarterOptions['mode'], string][] = [
    ...(allowNone ? ([['none', 'Points only (no pay)']] as [StarterOptions['mode'], string][]) : []),
    ['framework', 'Build salary bands'],
    ...(withPay.length ? ([['copy', 'Copy another structure’s pay setup']] as [StarterOptions['mode'], string][]) : []),
  ];

  return (
    <div className="stack">
      <div className="row" style={{ gap: 4 }}>
        {modes.map(([k, l]) => (
          <button key={k} className={`choice${value.mode === k ? ' on' : ''}`} onClick={() => set({ mode: k })}>{l}</button>
        ))}
      </div>
      {value.mode === 'framework' && (
        <>
          <div className="form-grid">
            <label className="field">Salary bands
              <input type="number" min={1} max={grades.length} value={value.bandCount} onChange={(e) => set({ bandCount: Number(e.target.value) })} />
            </label>
            <label className="field">Currency<input value={value.currency} onChange={(e) => set({ currency: e.target.value })} /></label>
            <label className="field">Minimum wage of
              <select value={value.region} onChange={(e) => set({ region: e.target.value })}>
                {regions.map((r) => <option key={r.region} value={r.region}>{r.region} ({fmt(r.amount)})</option>)}
              </select>
            </label>
            <label className="field">Lowest band minimum (anchor)
              <input type="number" min={0} step={1000} value={value.anchor} onChange={(e) => set({ anchor: Number(e.target.value) })} />
            </label>
            <label className="field">Band overlap<PctInput value={value.overlap} onChange={(v) => set({ overlap: v ?? 0 })} /></label>
            {(['Junior', 'Mid', 'Senior'] as const).map((t, i) => (
              <label className="field" key={t}>{t} range spread
                <PctInput value={value.spreads[i]} onChange={(v) => {
                  const s = [...value.spreads] as StarterOptions['spreads'];
                  s[i] = v ?? 0;
                  set({ spreads: s });
                }} />
              </label>
            ))}
          </div>
          <label className="row small">
            <input type="checkbox" checked={value.lift} onChange={(e) => set({ lift: e.target.checked })} />
            Raise the lowest band minimum to the minimum wage when the anchor is lower
          </label>
          <p className="small muted" style={{ margin: 0 }}>
            Grades are grouped into bands of near-equal size; the lowest band uses the Junior spread, the top 40% the Senior spread, the rest Mid.
            {grades.length === 23 && value.bandCount === 11 && ' With 23 grades and 11 bands the framework’s own grouping and cadres are used.'}
            {' '}Cadres, entitlements and every other input can be edited afterwards.
          </p>
        </>
      )}
      {value.mode === 'copy' && (
        <label className="field">Copy salary bands, cadres and inputs from
          <select value={value.copyFrom} onChange={(e) => set({ copyFrom: Number(e.target.value) })}>
            {withPay.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {table && <BandPreview table={table} />}
    </div>
  );
}

function BandPreview({ table }: { table: PayTable }) {
  return (
    <div className="table-wrap">
      {table.problems.length > 0 && <div className="alert error small">{table.problems.join('; ')}</div>}
      <table>
        <thead>
          <tr><th>Band</th><th>Cadre</th><th>Grades</th><th>Tier</th><th className="num">Minimum</th><th className="num">Midpoint</th><th className="num">Maximum</th><th>Check</th></tr>
        </thead>
        <tbody>
          {[...table.bands].reverse().map((b) => (
            <tr key={b.code}>
              <td><strong>{b.code}</strong></td>
              <td>{b.cadre}</td>
              <td>{gradeRange(b.gradeFrom, b.gradeTo)}</td>
              <td className="small">{b.tier} {pct(b.spread)}</td>
              <td className="num">{fmt(b.min)}</td>
              <td className="num">{fmt(b.mid)}</td>
              <td className="num">{fmt(b.max)}</td>
              <td>{b.belowMinimumWage ? <span className="badge b-returned">Below minimum wage</span> : <span className="badge b-approved">OK</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">{table.currency} per month (gross). Minimum wage applied: {fmt(table.minimumWage)}.</p>
    </div>
  );
}

const gradeRange = (a: number, b: number) => (a === b ? `G-${a}` : `G-${a} to G-${b}`);

// ====================================================================== editor

type PayTab = 'bands' | 'map' | 'cadres' | 'inputs' | 'placement';

/** Every detail of a structure's salary bands, editable, with the calculated results. */
export function PayEditor({ structure, structures, onSaved }: { structure: GradeStructure; structures: GradeStructure[]; onSaved: (msg: string) => void }) {
  const grades = structure.bands;
  const [starter, setStarter] = useState<StarterOptions>(() => ({ ...defaultStarter(grades, structures), mode: 'framework' }));
  const [draft, setDraft] = useState<PayModel | null>(structure.pay ? clone(structure.pay) : null);
  const [tab, setTab] = useState<PayTab>('bands');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(structure.pay ? clone(structure.pay) : null), [JSON.stringify(structure.pay)]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = useMemo(() => (draft ? computePay(draft, grades) : null), [draft, grades]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(structure.pay);

  const save = async (pay: PayModel | null, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/grade-structures/${structure.id}/pay`, { pay });
      onSaved(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!structure.pay && !draft) {
    return (
      <div className="stack">
        <ErrorAlert error={error} />
        <div className="alert info">
          {structure.name} grades jobs by points only. Add salary bands to group its {grades.length} job grades into pay ranges, with cadres, entitlements and cost to company.
        </div>
        <PayStarter grades={grades} structures={structures} value={starter} onChange={setStarter} allowNone={false} />
        <div className="row">
          <button className="primary" disabled={busy || !buildStarterModel(grades, starter, structures)}
            onClick={() => setDraft(buildStarterModel(grades, starter, structures))}>
            Continue to the details
          </button>
        </div>
      </div>
    );
  }
  if (!draft || !table) return null;
  const set = (p: Partial<PayModel>) => setDraft({ ...draft, ...p });

  return (
    <div className="stack">
      <ErrorAlert error={error} />
      {table.problems.length > 0 && (
        <div className="alert error">
          <strong>Fix before saving:</strong> {table.problems.join('; ')}
        </div>
      )}
      <div className="row spread">
        <div className="row" style={{ gap: 4 }} role="tablist">
          {([['bands', 'Salary bands'], ['map', 'Grade map'], ['cadres', 'Cadres & entitlements'], ['inputs', 'Pay inputs'], ['placement', 'Placement check']] as [PayTab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`choice${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="row">
          {structure.pay && (
            <button className="danger" disabled={busy} onClick={() => {
              if (confirm(`Remove the salary bands of ${structure.name}? Its job grades stay; jobs no longer show a pay range.`)) save(null, 'Salary bands removed.');
            }}>Remove salary bands</button>
          )}
          {dirty && <button disabled={busy} onClick={() => setDraft(structure.pay ? clone(structure.pay) : null)}>Discard changes</button>}
          <button className="primary" disabled={busy || !dirty || table.problems.length > 0} onClick={() => save(draft, 'Salary bands saved.')}>Save salary bands</button>
        </div>
      </div>

      <div className="grid grid-kpi">
        <div className="kpi"><div className="label small muted">Salary bands</div><div className="value">{table.bands.length}</div></div>
        <div className="kpi"><div className="label small muted">Job grades</div><div className="value">{grades.length}</div></div>
        <div className="kpi"><div className="label small muted">Minimum wage ({draft.region || '—'})</div><div className="value">{fmt(table.minimumWage)}</div></div>
        <div className="kpi"><div className="label small muted">Lowest minimum</div><div className="value">{fmt(table.bands[0]?.min)}</div></div>
        <div className="kpi"><div className="label small muted">Highest maximum</div><div className="value">{fmt(table.bands[table.bands.length - 1]?.max)}</div></div>
        <div className="kpi"><div className="label small muted">Currency (monthly gross)</div><div className="value">{draft.currency}</div></div>
      </div>

      {tab === 'bands' && <BandsTab draft={draft} set={set} table={table} grades={grades} />}
      {tab === 'map' && <GradeMapTab table={table} grades={grades} structureId={structure.id} />}
      {tab === 'cadres' && <CadresTab draft={draft} set={set} table={table} />}
      {tab === 'inputs' && <InputsTab draft={draft} set={set} />}
      {tab === 'placement' && <PlacementTab draft={draft} table={table} grades={grades} />}
    </div>
  );
}

// ---------------------------------------------------------------- bands tab

function BandsTab({ draft, set, table, grades }: { draft: PayModel; set: (p: Partial<PayModel>) => void; table: PayTable; grades: GradeBand[] }) {
  const [regroup, setRegroup] = useState(draft.bands.length);
  const byCode = new Map(table.bands.map((b) => [b.code, b]));
  const ordered = [...draft.bands].map((b, i) => ({ b, i })).sort((x, y) => y.b.gradeFrom - x.b.gradeFrom);
  const update = (i: number, p: Partial<PayModel['bands'][number]>) => set({ bands: draft.bands.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const lowest = draft.bands.reduce((a, b) => (b.gradeFrom < a.gradeFrom ? b : a), draft.bands[0]);
  const top = grades.length ? Math.max(...grades.map((g) => g.grade)) : 0;
  const lastTo = Math.max(...draft.bands.map((b) => b.gradeTo));

  return (
    <div className="stack">
      <div className="card table-wrap">
        <h3>Salary bands</h3>
        <p className="small muted">
          Each band holds a run of job grades and sets their pay range. Minimum = maximum of the band below × (1 − overlap), rounded; maximum = minimum × (1 + tier spread); midpoint halfway.
          The lowest band starts at the anchor{draft.liftToMinimumWage ? ', raised to the minimum wage when lower' : ''}.
        </p>
        <table>
          <thead>
            <tr>
              <th>Band</th><th>Cadre</th><th>Grades</th><th>Hay points</th><th>Tier</th><th>Overlap override</th><th>Rounding</th>
              <th className="num">Minimum</th><th className="num">Midpoint</th><th className="num">Maximum</th>
              <th className="num">Spread</th><th className="num">Overlap</th><th className="num">Mid step</th><th>Check</th><th />
            </tr>
          </thead>
          <tbody>
            {ordered.map(({ b, i }) => {
              const r = byCode.get(b.code);
              const isAnchor = b === lowest;
              return (
                <tr key={i}>
                  <td><input value={b.code} style={{ width: 64, minWidth: 0 }} onChange={(e) => update(i, { code: e.target.value })} /></td>
                  <td>
                    <select value={b.cadre} onChange={(e) => update(i, { cadre: e.target.value })}>
                      {!draft.cadres.some((c) => c.name === b.cadre) && <option value={b.cadre}>{b.cadre} (missing)</option>}
                      {draft.cadres.map((c) => <option key={c.name}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <span className="row" style={{ flexWrap: 'nowrap', gap: 2 }}>
                      <NumInput width={52} min={1} value={b.gradeFrom} onChange={(v) => update(i, { gradeFrom: v })} />
                      <span className="muted">–</span>
                      <NumInput width={52} min={1} value={b.gradeTo} onChange={(v) => update(i, { gradeTo: v })} />
                    </span>
                  </td>
                  <td className="small num">{r?.pointsFrom == null ? '—' : `${fmt(r.pointsFrom)}${r.pointsTo == null ? '+' : `–${fmt(r.pointsTo)}`}`}</td>
                  <td>
                    <select value={b.tier} onChange={(e) => update(i, { tier: e.target.value })}>
                      {draft.tiers.map((t) => <option key={t.name} value={t.name}>{t.name} ({pct(t.spread)})</option>)}
                    </select>
                  </td>
                  <td>{isAnchor ? <span className="small muted">anchor</span> : (
                    <PctInput value={b.overlapOverride} placeholder={String(draft.overlap * 100)} onChange={(v) => update(i, { overlapOverride: v })} />
                  )}</td>
                  <td><NumInput width={80} value={b.rounding} onChange={(v) => update(i, { rounding: v })} /></td>
                  <td className="num">{fmt(r?.min)}</td>
                  <td className="num"><strong>{fmt(r?.mid)}</strong></td>
                  <td className="num">{fmt(r?.max)}</td>
                  <td className="num small">{pct(r?.spreadActual)}</td>
                  <td className="num small">{pct(r?.overlapActual)}</td>
                  <td className="num small">{pct(r?.midpointProgression)}</td>
                  <td>{r?.belowMinimumWage ? <span className="badge b-returned">Below minimum wage</span> : <span className="badge b-approved">OK</span>}</td>
                  <td><button className="ghost danger" aria-label={`Remove ${b.code}`} disabled={draft.bands.length <= 1} onClick={() => set({ bands: draft.bands.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={lastTo >= top} onClick={() => {
            const n = draft.bands.length + 1;
            const last = [...draft.bands].sort((a, b) => b.gradeFrom - a.gradeFrom)[0];
            set({ bands: [...draft.bands, { ...last, code: `B-${n}`, gradeFrom: lastTo + 1, gradeTo: top, overlapOverride: null }] });
          }}>+ Add band for grades above G-{lastTo}</button>
          <span className="small muted" style={{ marginLeft: 12 }}>Regroup all {grades.length} grades into</span>
          <NumInput width={60} min={1} value={regroup} onChange={setRegroup} />
          <span className="small muted">bands</span>
          <button onClick={() => {
            const ladder = [...draft.bands].sort((a, b) => a.gradeFrom - b.gradeFrom).map((b) => b.cadre);
            set({ bands: generatePayBands(grades, regroup, { tiers: draft.tiers.map((t) => t.name), cadreNames: ladder, rounding: draft.bands[0]?.rounding ?? 5000 }) });
          }}>Regroup</button>
        </div>
      </div>

      <div className="card">
        <h3>Band ranges</h3>
        <p className="small muted">Minimum to maximum of each band on a logarithmic scale; the tick is the midpoint. Overlaps between neighbouring bands show where they share pay.</p>
        <RangeChart table={table} />
      </div>

      <div className="card table-wrap">
        <h3>Salary split and employer cost at midpoint</h3>
        <p className="small muted">
          Basic = midpoint ÷ (1 + {pct(draft.houseRent)} + {pct(draft.utilities)}). Monthly cost to company = midpoint + car allowance + provident fund + gratuity + EOBI + social security + bonus provision
          (travel, fuel, SIM and insurance premiums are not included).
        </p>
        <table>
          <thead>
            <tr>
              <th>Band</th><th className="num">Midpoint</th><th className="num">Basic</th><th className="num">House rent</th><th className="num">Utilities</th>
              <th className="num">Car allowance</th><th className="num">PF</th><th className="num">Gratuity</th><th className="num">EOBI</th><th className="num">Social security</th><th className="num">Bonus</th>
              <th className="num">Monthly CTC</th><th className="num">Annual CTC</th>
            </tr>
          </thead>
          <tbody>
            {[...table.bands].reverse().map((b) => (
              <tr key={b.code}>
                <td><strong>{b.code}</strong> <span className="small muted">{b.cadre}</span></td>
                <td className="num">{fmt(b.mid)}</td>
                <td className="num">{fmt(b.basic)}</td>
                <td className="num">{fmt(b.houseRent)}</td>
                <td className="num">{fmt(b.utilities)}</td>
                <td className="num">{b.cadreResult?.carAllowance == null ? <span className="muted">N/A</span> : fmt(b.cadreResult.carAllowance)}</td>
                <td className="num">{fmt(b.employer.pf)}</td>
                <td className="num">{fmt(b.employer.gratuity)}</td>
                <td className="num">{fmt(b.employer.eobi)}</td>
                <td className="num">{fmt(b.employer.socialSecurity)}</td>
                <td className="num">{fmt(b.employer.bonus)}</td>
                <td className="num"><strong>{fmt(b.ctcMonthly)}</strong></td>
                <td className="num">{fmt(b.ctcAnnual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RangeChart({ table }: { table: PayTable }) {
  const bands = [...table.bands].filter((b) => b.min > 0).reverse();
  if (!bands.length) return <p className="muted">No bands.</p>;
  const lo = Math.log(Math.min(...bands.map((b) => b.min)) * 0.9);
  const hi = Math.log(Math.max(...bands.map((b) => b.max)) * 1.05);
  const x = (v: number) => `${((Math.log(v) - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {bands.map((b) => (
        <div key={b.code} className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <span className="small" style={{ width: 150, flexShrink: 0 }}><strong>{b.code}</strong> <span className="muted">{b.cadre}</span></span>
          <div style={{ position: 'relative', flex: 1, height: 18, background: 'var(--surface-2)', borderRadius: 4 }}
            title={`${b.code}: ${fmt(b.min)} – ${fmt(b.max)} (mid ${fmt(b.mid)})`}>
            <div style={{ position: 'absolute', left: x(b.min), width: `calc(${x(b.max)} - ${x(b.min)})`, top: 3, bottom: 3, background: b.belowMinimumWage ? 'var(--danger)' : 'var(--accent)', opacity: 0.75, borderRadius: 3 }} />
            <div style={{ position: 'absolute', left: x(b.mid), top: 0, bottom: 0, width: 2, background: 'var(--text)' }} />
          </div>
          <span className="small num muted" style={{ width: 170, flexShrink: 0 }}>{fmt(b.min)} – {fmt(b.max)}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- grade map tab

function GradeMapTab({ table, grades, structureId }: { table: PayTable; grades: GradeBand[]; structureId: number }) {
  const jobs = useData<JobRecord[]>('/jobs');
  const count = (g: number) => (jobs.data ?? []).filter((j) => j.gradeStructure.id === structureId && j.result?.grade === g).length;
  const sorted = [...grades].sort((a, b) => b.grade - a.grade);
  return (
    <div className="card table-wrap">
      <h3>Job grades within salary bands</h3>
      <p className="small muted">
        Inside a band each job grade gets an equal slice (zone) of the range, so a higher-scored job in the same band is paid higher in the band. Single-grade bands use the full range.
      </p>
      <table>
        <thead>
          <tr>
            <th>Grade</th><th>Hay points</th><th>Career level</th><th>Band</th><th>Cadre</th><th>Position</th>
            <th className="num">Band min</th><th className="num">Band mid</th><th className="num">Band max</th>
            <th className="num">Zone min</th><th className="num">Zone reference</th><th className="num">Zone max</th><th className="num">Jobs</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((g, i) => {
            const z = table.zones.find((x) => x.grade === g.grade);
            const upper = i === 0 ? null : sorted[i - 1].minPoints - 1;
            return (
              <tr key={g.grade}>
                <td><strong>G-{g.grade}</strong></td>
                <td className="num small">{fmt(g.minPoints)}{upper === null ? '+' : `–${fmt(upper)}`}</td>
                <td className="small">{g.careerLevel}</td>
                {z ? (
                  <>
                    <td>{z.band}</td>
                    <td className="small">{z.cadre}</td>
                    <td className="small muted">{z.positionInBand} of {z.gradesInBand}</td>
                    <td className="num">{fmt(z.bandMin)}</td>
                    <td className="num">{fmt(z.bandMid)}</td>
                    <td className="num">{fmt(z.bandMax)}</td>
                    <td className="num">{fmt(z.zoneMin)}</td>
                    <td className="num"><strong>{fmt(z.zoneRef)}</strong></td>
                    <td className="num">{fmt(z.zoneMax)}</td>
                  </>
                ) : (
                  <td colSpan={9}><span className="badge b-returned">Not in any band</span></td>
                )}
                <td className="num">{count(g.grade) || <span className="muted">0</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- cadres tab

const CADRE_TEXT: [keyof CadreInput, string][] = [
  ['designations', 'Designations'],
  ['promotion', 'Promotion eligibility'],
  ['qualification', 'Minimum qualification'],
  ['experience', 'Ideal experience'],
  ['toolsVehicle', 'Tools of trade vehicle (sales & marketing)'],
  ['simRetail', 'SIM card limit (retail)'],
  ['simAll', 'SIM limit (all departments)'],
  ['floatingCash', 'Floating cash (field staff)'],
  ['transport', 'Transport — outstation'],
  ['room', 'Hospital room'],
];

function CadresTab({ draft, set, table }: { draft: PayModel; set: (p: Partial<PayModel>) => void; table: PayTable }) {
  const update = (i: number, p: Partial<CadreInput>) => {
    const old = draft.cadres[i];
    const cadres = draft.cadres.map((c, j) => (j === i ? { ...c, ...p } : c));
    // Renaming a cadre keeps its bands attached.
    const bands = p.name !== undefined && p.name !== old.name ? draft.bands.map((b) => (b.cadre === old.name ? { ...b, cadre: p.name! } : b)) : draft.bands;
    set({ cadres, bands });
  };
  const usedBy = (name: string) => draft.bands.filter((b) => b.cadre === name).map((b) => b.code);
  const results = new Map(table.bands.filter((b) => b.cadreResult).map((b) => [b.cadre, b.cadreResult!]));
  const order = (name: string) => Math.min(...draft.bands.filter((b) => b.cadre === name).map((b) => b.gradeFrom), 999);
  const ordered = draft.cadres.map((c, i) => ({ c, i })).sort((a, b) => order(b.c.name) - order(a.c.name));

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>Every band in a cadre inherits these entitlements. Money values are in {draft.currency}.</p>
      {ordered.map(({ c, i }) => {
        const r = results.get(c.name);
        const bands = usedBy(c.name);
        return (
          <details key={i} className="grade-group">
            <summary>
              <span className="grade-pill">{bands.join(', ') || '—'}</span>
              <strong style={{ minWidth: 140 }}>{c.name}</strong>
              <span className="small muted" style={{ flex: 1 }}>
                {c.vehicleClass ? `${c.vehicleClass} · car allowance ${fmt(r?.carAllowance)}` : 'No vehicle'} · {c.conveyance} · hotel {fmt(c.hotelCap)}/night ·
                IPD {c.ipdCover == null ? 'social security' : fmt(c.ipdCover)} · life {c.lifeMultiple}× gross
              </span>
            </summary>
            <div className="body stack">
              <div className="form-grid">
                <label className="field">Cadre name<input value={c.name} onChange={(e) => update(i, { name: e.target.value })} /></label>
                {CADRE_TEXT.map(([k, l]) => (
                  <label key={k} className="field">{l}<input value={String(c[k] ?? '')} onChange={(e) => update(i, { [k]: e.target.value } as Partial<CadreInput>)} /></label>
                ))}
              </div>
              <h3 style={{ marginTop: 8 }}>Vehicle, fuel and travel</h3>
              <div className="form-grid">
                <label className="field">Benefit vehicle class
                  <select value={c.vehicleClass} onChange={(e) => update(i, { vehicleClass: e.target.value })}>
                    <option value="">None</option>
                    {draft.vehicles.map((v) => <option key={v.vehicleClass} value={v.vehicleClass}>{v.vehicleClass} · {v.model}</option>)}
                  </select>
                </label>
                <label className="field">Fuel conveyance
                  <select value={c.conveyance} onChange={(e) => update(i, { conveyance: e.target.value as CadreInput['conveyance'] })}>
                    <option>Car</option><option>Motorcycle</option>
                  </select>
                </label>
                <label className="field">Hotel cap per night<NumInput value={c.hotelCap} onChange={(v) => update(i, { hotelCap: v })} /></label>
                <label className="field">Hotel non-utilisation<PctInput value={c.hotelNonUtilisation} onChange={(v) => update(i, { hotelNonUtilisation: v ?? 0 })} /></label>
                <label className="field">Meal rate (one meal)<NumInput value={c.mealRate} onChange={(v) => update(i, { mealRate: v })} /></label>
              </div>
              <h3 style={{ marginTop: 8 }}>Health and life</h3>
              <div className="form-grid">
                <label className="field">In-patient cover per family p.a. (blank = social security)
                  <input type="number" min={0} value={c.ipdCover ?? ''} onChange={(e) => update(i, { ipdCover: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
                <label className="field">Out-patient (months of basic p.a.)<NumInput value={c.opdMonths} onChange={(v) => update(i, { opdMonths: v })} /></label>
                <label className="field">Group life (× gross monthly)<NumInput value={c.lifeMultiple} onChange={(v) => update(i, { lifeMultiple: v })} /></label>
                <label className="field">Social security (PESSI / SESSI)
                  <select value={c.socialSecurity ? 'yes' : 'no'} onChange={(e) => update(i, { socialSecurity: e.target.value === 'yes' })}>
                    <option value="yes">Covered</option><option value="no">Not covered</option>
                  </select>
                </label>
              </div>
              {r && (
                <div className="score-box small">
                  <strong>Calculated:</strong> car allowance {r.carAllowance == null ? 'N/A' : `${fmt(r.carAllowance)} (${r.vehicleModel}, value ${fmt(r.vehicleValue)})`} ·
                  fuel {r.fuelNorm}, {r.fuelRatePerKm} per km · hotel non-utilisation {fmt(r.hotelNonUtilisationPerDay)} per day ·
                  food {fmt(r.foodOutstationPerDay)} outstation / {fmt(r.foodLocalPerDay)} local per day
                </div>
              )}
              <div>
                <button className="danger" disabled={bands.length > 0} title={bands.length ? 'Move its bands to another cadre first' : ''}
                  onClick={() => set({ cadres: draft.cadres.filter((_, j) => j !== i) })}>Delete cadre</button>
              </div>
            </div>
          </details>
        );
      })}
      <div>
        <button onClick={() => {
          let n = draft.cadres.length + 1;
          while (draft.cadres.some((c) => c.name === `Cadre ${n}`)) n++;
          set({ cadres: [...draft.cadres, EMPTY_CADRE(`Cadre ${n}`)] });
        }}>+ Add cadre</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- inputs tab

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {note && <p className="small muted">{note}</p>}
      {children}
    </div>
  );
}

function InputsTab({ draft, set }: { draft: PayModel; set: (p: Partial<PayModel>) => void }) {
  const wage = minimumWage(draft);
  return (
    <div className="grid grid-2">
      <Section title="Minimum wage and anchor" note="The lowest band starts at the anchor; every other band is chained from it.">
        <table>
          <thead><tr><th>Region</th><th className="num">Monthly minimum wage</th><th>Note</th><th /></tr></thead>
          <tbody>
            {draft.minimumWages.map((w, i) => (
              <tr key={i}>
                <td><input value={w.region} onChange={(e) => {
                  const region = e.target.value;
                  set({ minimumWages: draft.minimumWages.map((x, j) => (j === i ? { ...x, region } : x)), ...(draft.region === w.region ? { region } : {}) });
                }} /></td>
                <td className="num"><NumInput value={w.amount} onChange={(v) => set({ minimumWages: draft.minimumWages.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></td>
                <td><input value={w.note} onChange={(e) => set({ minimumWages: draft.minimumWages.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} /></td>
                <td><button className="ghost danger" disabled={draft.region === w.region} onClick={() => set({ minimumWages: draft.minimumWages.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={{ marginTop: 8 }} onClick={() => set({ minimumWages: [...draft.minimumWages, { region: `Region ${draft.minimumWages.length + 1}`, amount: 0, note: '' }] })}>+ Add region</button>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field">Staff are employed in
            <select value={draft.region} onChange={(e) => set({ region: e.target.value })}>
              {draft.minimumWages.map((w) => <option key={w.region}>{w.region}</option>)}
            </select>
          </label>
          <label className="field">Applicable minimum wage<input disabled value={fmt(wage)} /></label>
          <label className="field">Currency<input value={draft.currency} onChange={(e) => set({ currency: e.target.value })} /></label>
          <label className="field">Lowest band minimum (anchor)<NumInput value={draft.anchor} onChange={(v) => set({ anchor: v })} /></label>
        </div>
        <label className="row small" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={draft.liftToMinimumWage} onChange={(e) => set({ liftToMinimumWage: e.target.checked })} />
          Raise the anchor to the minimum wage when it is lower {draft.anchor < wage && !draft.liftToMinimumWage && <span className="badge b-returned">anchor is below the minimum wage</span>}
        </label>
      </Section>

      <Section title="Band formula" note="Overlap: band minimum = maximum of the band below × (1 − overlap). Spread: maximum = minimum × (1 + spread). A band can override the overlap.">
        <div className="form-grid">
          <label className="field">Standard overlap<PctInput value={draft.overlap} onChange={(v) => set({ overlap: v ?? 0 })} /></label>
          <label className="field">Grade zone rounding<NumInput value={draft.zoneRounding} onChange={(v) => set({ zoneRounding: v })} /></label>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Tier</th><th>Range spread</th><th>Bands</th><th /></tr></thead>
          <tbody>
            {draft.tiers.map((t, i) => {
              const used = draft.bands.filter((b) => b.tier === t.name).map((b) => b.code);
              return (
                <tr key={i}>
                  <td><input value={t.name} onChange={(e) => {
                    const name = e.target.value;
                    set({ tiers: draft.tiers.map((x, j) => (j === i ? { ...x, name } : x)), bands: draft.bands.map((b) => (b.tier === t.name ? { ...b, tier: name } : b)) });
                  }} /></td>
                  <td><PctInput value={t.spread} onChange={(v) => set({ tiers: draft.tiers.map((x, j) => (j === i ? { ...x, spread: v ?? 0 } : x)) })} /></td>
                  <td className="small muted">{used.join(', ') || '—'}</td>
                  <td><button className="ghost danger" disabled={used.length > 0} onClick={() => set({ tiers: draft.tiers.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button style={{ marginTop: 8 }} onClick={() => set({ tiers: [...draft.tiers, { name: `Tier ${draft.tiers.length + 1}`, spread: 0.5 }] })}>+ Add tier</button>
      </Section>

      <Section title="Salary composition" note="Gross = basic × (1 + house rent + utilities). Basic is the base for provident fund, gratuity, OPD and bonus.">
        <div className="form-grid">
          <label className="field">House rent (% of basic)<PctInput value={draft.houseRent} onChange={(v) => set({ houseRent: v ?? 0 })} /></label>
          <label className="field">Utilities (% of basic)<PctInput value={draft.utilities} onChange={(v) => set({ utilities: v ?? 0 })} /></label>
        </div>
      </Section>

      <Section title="Retirement, statutory and bonus" note="EOBI and social security (PESSI / SESSI) are charged on the minimum wage unless a different base is entered.">
        <div className="form-grid">
          <label className="field">End-of-service scheme
            <select value={draft.retirement} onChange={(e) => set({ retirement: e.target.value as PayModel['retirement'] })}>
              {RETIREMENT_SCHEMES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">Employer provident fund (% of basic)<PctInput value={draft.pfRate} onChange={(v) => set({ pfRate: v ?? 0 })} /></label>
          <label className="field">Gratuity (months of basic per year)<NumInput value={draft.gratuityMonths} onChange={(v) => set({ gratuityMonths: v })} /></label>
          <label className="field">EOBI employer<PctInput value={draft.eobiEmployer} onChange={(v) => set({ eobiEmployer: v ?? 0 })} /></label>
          <label className="field">EOBI employee<PctInput value={draft.eobiEmployee} onChange={(v) => set({ eobiEmployee: v ?? 0 })} /></label>
          <label className="field">EOBI wage base (blank = minimum wage)
            <input type="number" min={0} value={draft.eobiBase ?? ''} placeholder={fmt(wage)} onChange={(e) => set({ eobiBase: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label className="field">Social security employer<PctInput value={draft.socialSecurityRate} onChange={(v) => set({ socialSecurityRate: v ?? 0 })} /></label>
          <label className="field">Social security wage cap (blank = minimum wage)
            <input type="number" min={0} value={draft.socialSecurityCap ?? ''} placeholder={fmt(wage)} onChange={(e) => set({ socialSecurityCap: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label className="field">Bonus provision (months of basic per year)<NumInput value={draft.bonusMonths} onChange={(v) => set({ bonusMonths: v })} /></label>
        </div>
      </Section>

      <Section title="Vehicles and fuel" note="Car allowance per month = vehicle value × rate, rounded. Fuel rate per km = fuel price ÷ km per litre.">
        <table>
          <thead><tr><th>Vehicle class</th><th>Reference model</th><th className="num">List price</th><th /></tr></thead>
          <tbody>
            {draft.vehicles.map((v, i) => {
              const used = draft.cadres.some((c) => c.vehicleClass === v.vehicleClass);
              return (
                <tr key={i}>
                  <td><input value={v.vehicleClass} onChange={(e) => {
                    const vehicleClass = e.target.value;
                    set({ vehicles: draft.vehicles.map((x, j) => (j === i ? { ...x, vehicleClass } : x)), cadres: draft.cadres.map((c) => (c.vehicleClass === v.vehicleClass ? { ...c, vehicleClass } : c)) });
                  }} /></td>
                  <td><input value={v.model} onChange={(e) => set({ vehicles: draft.vehicles.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)) })} /></td>
                  <td className="num"><NumInput width={120} value={v.price} onChange={(p) => set({ vehicles: draft.vehicles.map((x, j) => (j === i ? { ...x, price: p } : x)) })} /></td>
                  <td><button className="ghost danger" disabled={used} onClick={() => set({ vehicles: draft.vehicles.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button style={{ marginTop: 8 }} onClick={() => set({ vehicles: [...draft.vehicles, { vehicleClass: `Class ${draft.vehicles.length + 1}`, model: '', price: 0 }] })}>+ Add vehicle class</button>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field">Car allowance (% of value per month)<PctInput value={draft.carAllowanceRate} onChange={(v) => set({ carAllowanceRate: v ?? 0 })} /></label>
          <label className="field">Car allowance rounding<NumInput value={draft.carAllowanceRounding} onChange={(v) => set({ carAllowanceRounding: v })} /></label>
          <label className="field">Fuel price per litre<input type="number" min={0} step="0.1" value={draft.fuelPrice} onChange={(e) => set({ fuelPrice: Number(e.target.value) })} /></label>
          <label className="field">Car: km per litre<NumInput value={draft.carKmPerLitre} onChange={(v) => set({ carKmPerLitre: v })} /></label>
          <label className="field">Motorcycle: km per litre<NumInput value={draft.bikeKmPerLitre} onChange={(v) => set({ bikeKmPerLitre: v })} /></label>
        </div>
      </Section>

      <Section title="Travel" note="Hotel non-utilisation = hotel cap × the cadre’s %, rounded. Food per day = meal rate × meals.">
        <div className="form-grid">
          <label className="field">Hotel non-utilisation rounding<NumInput value={draft.hotelRounding} onChange={(v) => set({ hotelRounding: v })} /></label>
          <label className="field">Meals per day, outstation<NumInput value={draft.mealsOutstation} onChange={(v) => set({ mealsOutstation: v })} /></label>
          <label className="field">Meals per day, local offsite<NumInput value={draft.mealsLocal} onChange={(v) => set({ mealsLocal: v })} /></label>
        </div>
      </Section>
    </div>
  );
}

// -------------------------------------------------------------- placement tab

function PlacementTab({ draft, table, grades }: { draft: PayModel; table: PayTable; grades: GradeBand[] }) {
  const [points, setPoints] = useState(206);
  const [salary, setSalary] = useState(62000);
  const [vehicle, setVehicle] = useState(false);
  const [pfMember, setPfMember] = useState(true);
  const sorted = [...grades].sort((a, b) => a.minPoints - b.minPoints);
  const grade = [...sorted].reverse().find((g) => points >= g.minPoints)?.grade ?? sorted[0]?.grade;
  const r = grade ? placeSalary(table, draft, grade, salary, { vehicle, pfMember }) : null;
  const tone = !r ? '' : r.position === 'In zone' ? 'b-approved' : r.position.startsWith('In band') ? 'b-submitted' : 'b-returned';

  return (
    <div className="grid grid-2">
      <div className="card">
        <h3>Place a salary</h3>
        <p className="small muted">Enter a job’s Hay points and an employee’s current gross monthly salary to see where it sits in the band and what it costs.</p>
        <div className="form-grid">
          <label className="field">Hay points<NumInput value={points} onChange={setPoints} /></label>
          <label className="field">Current gross salary ({draft.currency} / month)<NumInput width={140} value={salary} onChange={setSalary} /></label>
        </div>
        <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={vehicle} onChange={(e) => setVehicle(e.target.checked)} /> Takes the car allowance of the cadre</label>
        <label className="row small"><input type="checkbox" checked={pfMember} onChange={(e) => setPfMember(e.target.checked)} /> Provident fund member</label>
      </div>
      <div className="card">
        {!r ? <p className="muted">That grade is not in any salary band.</p> : (
          <div className="stack">
            <div className="row">
              <span className="grade-pill">G-{r.zone.grade}</span>
              <strong>{r.zone.band} · {r.zone.cadre}</strong>
              <span className={`badge ${tone}`}>{r.position}</span>
            </div>
            <table>
              <tbody>
                <tr><td>Band</td><td className="num">{fmt(r.zone.bandMin)} – {fmt(r.zone.bandMax)} (mid {fmt(r.zone.bandMid)})</td></tr>
                <tr><td>Grade zone</td><td className="num">{fmt(r.zone.zoneMin)} – {fmt(r.zone.zoneMax)}</td></tr>
                <tr><td>Compa-ratio (band midpoint)</td><td className="num"><strong>{pct(r.compaRatio, 1)}</strong></td></tr>
                <tr><td>Range penetration</td><td className="num">{pct(r.rangePenetration, 1)}</td></tr>
                <tr><td>Basic / house rent / utilities</td><td className="num">{fmt(r.basic)} / {fmt(r.houseRent)} / {fmt(r.utilities)}</td></tr>
                <tr><td>Car allowance</td><td className="num">{fmt(r.carAllowance)}</td></tr>
                <tr><td>PF / gratuity / EOBI / social security / bonus</td><td className="num">{fmt(r.employer.pf)} / {fmt(r.employer.gratuity)} / {fmt(r.employer.eobi)} / {fmt(r.employer.socialSecurity)} / {fmt(r.employer.bonus)}</td></tr>
                <tr><td><strong>Monthly cost to company</strong></td><td className="num"><strong>{fmt(r.ctcMonthly)}</strong></td></tr>
                <tr><td>Annual cost to company</td><td className="num">{fmt(r.ctcAnnual)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** One-line pay placement of a graded job, for result views. */
export function PayLine({ pay }: { pay: { band: string; cadre: string; bandMin: number; bandMid: number; bandMax: number; zoneMin: number; zoneMax: number; currency: string } | null | undefined }) {
  if (!pay) return null;
  return (
    <span className="small">
      Band <strong>{pay.band}</strong> · {pay.cadre} · {pay.currency} {fmt(pay.bandMin)}–{fmt(pay.bandMax)} (mid {fmt(pay.bandMid)}) · grade zone {fmt(pay.zoneMin)}–{fmt(pay.zoneMax)}
    </span>
  );
}
