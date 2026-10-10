import { useEffect, useMemo, useRef, useState } from 'react';
import type { Evaluation } from '../api';
import { STATUS_LABEL } from './ui';

export type Dim = 'company' | 'department' | 'role' | 'family' | 'grade' | 'career' | 'status' | 'evaluator';
export type Filters = Partial<Record<Dim, string[]>>;

export const DIM_LABEL: Record<Dim, string> = {
  company: 'Company',
  department: 'Department',
  role: 'Role',
  family: 'Job family',
  grade: 'Grade',
  career: 'Career level',
  status: 'Status',
  evaluator: 'Evaluator',
};

const NONE = '(none)';

/** The value an evaluation has on each slicer dimension. */
export function dimValue(e: Evaluation, d: Dim): string {
  switch (d) {
    case 'company': return e.company.name;
    case 'department': return `${e.department.name}`;
    case 'role': return e.position.title;
    case 'family': return e.position.jobFamily || NONE;
    case 'grade': return e.result?.grade != null ? String(e.result.grade) : 'Ungraded';
    case 'career': return e.result?.careerLevel || 'Ungraded';
    case 'status': return e.status;
    case 'evaluator': return e.evaluator?.name ?? 'JD analysis';
  }
}

export function applyFilters(rows: Evaluation[], f: Filters, except?: Dim) {
  return rows.filter((e) =>
    (Object.keys(f) as Dim[]).every((d) => d === except || !f[d]?.length || f[d]!.includes(dimValue(e, d))),
  );
}

const sortValues = (d: Dim, vals: string[]) =>
  d === 'grade'
    ? vals.sort((a, b) => (Number(a) || 999) - (Number(b) || 999))
    : vals.sort((a, b) => a.localeCompare(b));

function Slicer({
  dim,
  rows,
  filters,
  onChange,
}: {
  dim: Dim;
  rows: Evaluation[];
  filters: Filters;
  onChange: (vals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = filters[dim] ?? [];

  // Options cascade: they reflect the other active slicers (e.g. departments of the chosen company).
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of applyFilters(rows, filters, dim)) {
      const v = dimValue(e, dim);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
    return sortValues(dim, [...counts.keys()]).map((v) => ({ v, n: counts.get(v)! }));
  }, [rows, filters, dim, selected]);

  useEffect(() => {
    const close = (ev: MouseEvent) => ref.current && !ref.current.contains(ev.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const label = (v: string) => (dim === 'status' ? STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v : dim === 'grade' && v !== 'Ungraded' ? `Grade ${v}` : v);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  return (
    <div className="slicer" ref={ref}>
      <label className="field">
        {DIM_LABEL[dim]}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span>{selected.length === 0 ? 'All' : selected.length === 1 ? label(selected[0]) : `${selected.length} selected`}</span>
          <span aria-hidden>▾</span>
        </button>
      </label>
      {open && (
        <div className="menu">
          <div className="row spread small" style={{ padding: '2px 6px 6px' }}>
            <button className="ghost" onClick={() => onChange(options.map((o) => o.v))}>Select all</button>
            <button className="ghost" onClick={() => onChange([])}>Clear</button>
          </div>
          {options.map((o) => (
            <label key={o.v}>
              <input type="checkbox" checked={selected.includes(o.v)} onChange={() => toggle(o.v)} />
              <span style={{ flex: 1 }}>{label(o.v)}</span>
              <span className="muted small">{o.n}</span>
            </label>
          ))}
          {options.length === 0 && <div className="muted small" style={{ padding: 6 }}>No values</div>}
        </div>
      )}
    </div>
  );
}

export function SlicerBar({
  rows,
  filters,
  onChange,
  dims = ['company', 'department', 'role', 'grade', 'family', 'career', 'status', 'evaluator'],
}: {
  rows: Evaluation[];
  filters: Filters;
  onChange: (f: Filters) => void;
  dims?: Dim[];
}) {
  const active = (Object.keys(filters) as Dim[]).filter((d) => filters[d]?.length);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="slicers">
        {dims.map((d) => (
          <Slicer key={d} dim={d} rows={rows} filters={filters} onChange={(vals) => onChange({ ...filters, [d]: vals })} />
        ))}
      </div>
      {active.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          {active.flatMap((d) =>
            filters[d]!.map((v) => (
              <span className="chip" key={`${d}:${v}`}>
                {DIM_LABEL[d]}: {d === 'status' ? STATUS_LABEL[v as keyof typeof STATUS_LABEL] : v}
                <button aria-label="Remove" onClick={() => onChange({ ...filters, [d]: filters[d]!.filter((x) => x !== v) })}>×</button>
              </span>
            )),
          )}
          <button className="ghost" onClick={() => onChange({})}>Clear all</button>
        </div>
      )}
    </div>
  );
}
