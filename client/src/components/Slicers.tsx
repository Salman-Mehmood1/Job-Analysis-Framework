import { useEffect, useMemo, useRef, useState } from 'react';
import type { Evaluation, JobRecord } from '../api';
import { STATUS_LABEL } from './ui';

export type Dim = 'company' | 'department' | 'role' | 'family' | 'structure' | 'grade' | 'career' | 'status' | 'evaluator';
export type Filters = Partial<Record<Dim, string[]>>;

export const DIM_LABEL: Record<Dim, string> = {
  company: 'Company',
  department: 'Department',
  role: 'Role',
  family: 'Job family',
  structure: 'Grade structure',
  grade: 'Grade',
  career: 'Career level',
  status: 'Status',
  evaluator: 'Evaluator',
};

const NONE = '(none)';

/** Slicers work on individual evaluations or on job-level records. */
export type SliceRow = Evaluation | JobRecord;

const evaluatorNames = (r: SliceRow) =>
  'evaluators' in r ? r.evaluators.map((e) => e.name) : [r.evaluator?.name ?? 'JD analysis'];

/** The values a row has on a slicer dimension (a job can have several evaluators). */
export function dimValues(e: SliceRow, d: Dim): string[] {
  return d === 'evaluator' ? evaluatorNames(e) : [dimValue(e, d)];
}

/** The single value a row has on a dimension (evaluators joined). */
export function dimValue(e: SliceRow, d: Dim): string {
  switch (d) {
    case 'company': return e.company.name;
    case 'department': return `${e.department.name}`;
    case 'role': return e.position.title;
    case 'family': return e.position.jobFamily || NONE;
    case 'structure': return e.gradeStructure.name;
    // Grade numbers only mean something within their structure, so the value carries both.
    case 'grade': return e.result?.grade != null ? `${e.gradeStructure.name} · G${e.result.grade}` : 'Ungraded';
    case 'career': return e.result?.careerLevel || 'Ungraded';
    case 'status': return e.status;
    case 'evaluator': return evaluatorNames(e).join(', ');
  }
}

export function applyFilters<T extends SliceRow>(rows: T[], f: Filters, except?: Dim): T[] {
  return rows.filter((e) =>
    (Object.keys(f) as Dim[]).every((d) => d === except || !f[d]?.length || dimValues(e, d).some((v) => f[d]!.includes(v))),
  );
}

// Numeric-aware so "Standard · G9" sorts before "Standard · G10"; "Ungraded" last.
const sortValues = (_d: Dim, vals: string[]) =>
  vals.sort((a, b) => (a === 'Ungraded' ? 1 : b === 'Ungraded' ? -1 : a.localeCompare(b, undefined, { numeric: true })));

function Slicer({
  dim,
  rows,
  filters,
  onChange,
}: {
  dim: Dim;
  rows: SliceRow[];
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
      for (const v of dimValues(e, dim)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
    return sortValues(dim, [...counts.keys()]).map((v) => ({ v, n: counts.get(v)! }));
  }, [rows, filters, dim, selected]);

  useEffect(() => {
    const close = (ev: MouseEvent) => ref.current && !ref.current.contains(ev.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const label = (v: string) => (dim === 'status' ? STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v : v);
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
  dims = ['company', 'department', 'role', 'structure', 'grade', 'family', 'career', 'status', 'evaluator'],
}: {
  rows: SliceRow[];
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
