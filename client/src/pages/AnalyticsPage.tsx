import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GradeBand, JobRecord } from '../api';
import { BASIS_LABEL, JobBadges, jobHref, spreadFlag } from '../components/JobBits';
import { GradeGroups } from '../components/GradeGroups';
import { type Dim, type Filters, SlicerBar, applyFilters, dimValue } from '../components/Slicers';
import { ErrorAlert, Kpi, STATUS_LABEL, StatusBadge, downloadCsv, fmt } from '../components/ui';
import { useData, useUser } from '../hooks';

const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const MAX_STACK = 7; // 8th slot is "Other"

type Tab = 'overview' | 'grades' | 'table';

function ChartTip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => p.value);
  return (
    <div className="chart-tip">
      <div className="t">{label}</div>
      {items.map((p) => (
        <div key={p.name}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.name}: <strong>{fmt(p.value)}</strong>{unit}</div>
      ))}
      {items.length > 1 && <div className="muted">Total: {fmt(items.reduce((s, p) => s + p.value, 0))}{unit}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const user = useUser();
  const nav = useNavigate();
  const evals = useData<JobRecord[]>('/jobs');
  const grades = useData<{ grades: GradeBand[] }>('/grades');
  const [filters, setFilters] = useState<Filters>({});
  const [tab, setTab] = useState<Tab>('overview');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'points', dir: -1 });
  const linkBase = user.role === 'admin' ? '/admin' : '/management';

  const all = evals.data ?? [];
  const rows = useMemo(() => applyFilters(all, filters), [all, filters]);
  const scored = rows.filter((r) => r.result?.complete);
  const gradeList = grades.data?.grades ?? [];

  // Jobs per grade, stacked by company. Company colours follow the full, unfiltered company list so a slicer never repaints them.
  const companyOrder = useMemo(() => [...new Set(all.map((r) => r.company.name))].sort(), [all]);
  const stackKey = (c: string) => (companyOrder.indexOf(c) < MAX_STACK ? c : 'Other');
  const stackKeys = [...new Set(companyOrder.map(stackKey))];
  const perGrade = gradeList.map((g) => {
    const row: Record<string, number | string> = { grade: `G${g.grade}` };
    for (const k of stackKeys) row[k] = 0;
    for (const r of scored) if (r.result!.grade === g.grade) row[stackKey(r.company.name)] = (row[stackKey(r.company.name)] as number) + 1;
    return row;
  });
  const lastUsed = perGrade.reduce((m, r, i) => (stackKeys.some((k) => r[k]) ? i : m), -1);
  const firstUsed = perGrade.findIndex((r) => stackKeys.some((k) => r[k]));
  const gradeData = firstUsed < 0 ? [] : perGrade.slice(Math.max(0, firstUsed - 1), lastUsed + 2);

  const byDept = useMemo(() => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const r of scored) {
      const k = r.department.name;
      const v = m.get(k) ?? { sum: 0, n: 0 };
      v.sum += r.result!.totalPoints!;
      v.n++;
      m.set(k, v);
    }
    return [...m.entries()].map(([k, v]) => ({ department: k, avg: Math.round(v.sum / v.n), n: v.n })).sort((a, b) => b.avg - a.avg);
  }, [scored]);

  const statusCounts = (Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => ({ s, n: rows.filter((r) => r.status === s).length }));
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.result!.totalPoints!, 0) / scored.length) : null;
  const flagged = scored.filter((r) => r.result!.checks.length).length;

  const sortVal = (r: JobRecord, k: string): string | number =>
    k === 'points' ? r.result?.totalPoints ?? -1 : k === 'grade' ? r.result?.grade ?? -1 : k === 'code' ? r.position.code : dimValue(r, k as Dim);
  const tableRows = [...rows].sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const th = (key: string, label: string, num = false) => (
    <th className={num ? 'num' : ''} style={{ cursor: 'pointer' }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const exportCsv = () =>
    downloadCsv('job-evaluations.csv', [
      ['Code', 'Role', 'Job family', 'Company', 'Department', 'Evaluators', 'Result basis', 'Status', 'KH tech', 'KH breadth', 'KH HR', 'KH shade', 'PS env', 'PS challenge', 'PS pick', 'AC freedom', 'AC magnitude', 'AC impact', 'AC shade', 'KH pts', 'PS %', 'PS pts', 'AC pts', 'Total', 'Profile', 'Grade', 'Career level', 'Checks', 'Adjusted by management', 'Lowest evaluator total', 'Highest evaluator total'],
      ...tableRows.map((r) => {
        const i = r.effectiveInputs;
        const x = r.result;
        return [
          r.position.code, r.position.title, r.position.jobFamily, r.company.name, r.department.name, r.evaluators.map((e) => e.name).join('; '), BASIS_LABEL[r.basis], STATUS_LABEL[r.status],
          i?.khTechnical, i?.khBreadth, i?.khHumanRelations, i?.khShade, i?.psEnvironment, i?.psChallenge, i?.psPick, i?.acFreedom, i?.acMagnitude, i?.acImpact, i?.acShade,
          x?.khPoints, x?.psPercent, x?.psPoints, x?.acPoints, x?.totalPoints, x?.profile, x?.grade, x?.careerLevel, x?.checks.join('; '),
          r.adjusted ? 'Yes' : 'No', r.spread?.minPoints, r.spread?.maxPoints,
        ];
      }),
    ]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{user.role === 'admin' ? 'Organisation dashboard' : 'Management dashboard'}</h1>
          <p className="muted">One row per job. Jobs with several evaluators use their calibrated result, or the provisional consensus until calibration is approved. Use the slicers to focus on a company, department, role or grade.</p>
        </div>
        <button onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      <ErrorAlert error={evals.error ?? grades.error} />

      <SlicerBar rows={all} filters={filters} onChange={setFilters} />

      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <Kpi label="Jobs in view" value={fmt(rows.length)} />
        <Kpi label="Scored" value={fmt(scored.length)} />
        <Kpi label="Approved" value={fmt(statusCounts.find((s) => s.s === 'approved')!.n)} />
        <Kpi label="Awaiting review" value={fmt(statusCounts.find((s) => s.s === 'submitted')!.n)} />
        <Kpi label="Average points" value={fmt(avg)} />
        <Kpi label="Flagged by checks" value={fmt(flagged)} />
        <Kpi label="Evaluators >1 grade apart" value={fmt(rows.filter((r) => spreadFlag(r)).length)} />
      </div>

      <div className="tabs" role="tablist">
        {(['overview', 'grades', 'table'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'grades' ? 'Positions by grade' : 'Data table'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-2">
          <div className="card">
            <h2>Jobs per grade</h2>
            <p className="muted small">Scored positions in each grade of the current structure, by company.</p>
            {stackKeys.length > 1 && (
              <div className="legend">
                {stackKeys.map((k, i) => <span key={k}><i style={{ background: SERIES[k === 'Other' ? 7 : i] }} />{k}</span>)}
              </div>
            )}
            {gradeData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={gradeData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="grade" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip unit="" />} cursor={{ fill: 'var(--surface-2)' }} />
                  {stackKeys.map((k, i) => (
                    <Bar key={k} dataKey={k} stackId="g" fill={SERIES[k === 'Other' ? 7 : i]} stroke="var(--surface)" strokeWidth={1}
                      radius={i === stackKeys.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={36} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="muted">No scored positions in view.</div>}
          </div>

          <div className="card">
            <h2>Average points by department</h2>
            <p className="muted small">Mean total Hay points of scored positions.</p>
            {byDept.length ? (
              <ResponsiveContainer width="100%" height={Math.max(160, byDept.length * 30 + 40)}>
                <BarChart data={byDept} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="var(--grid)" />
                  <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="department" width={140} tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip unit=" pts" />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="avg" name="Average points" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18}
                    label={{ position: 'right', fill: 'var(--muted)', fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="muted">No scored positions in view.</div>}
          </div>

          <div className="card">
            <h2>Progress</h2>
            <table>
              <tbody>
                {statusCounts.map(({ s, n }) => (
                  <tr key={s}>
                    <td><StatusBadge status={s} /></td>
                    <td style={{ width: '60%' }}><div className="bar-track" style={{ maxWidth: 'none' }}><div className="bar-fill" style={{ width: `${rows.length ? (n / rows.length) * 100 : 0}%` }} /></div></td>
                    <td className="num">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Highest-scored roles</h2>
            <table>
              <thead><tr><th>Role</th><th>Company</th><th className="num">Points</th><th className="num">Grade</th></tr></thead>
              <tbody>
                {[...scored].sort((a, b) => b.result!.totalPoints! - a.result!.totalPoints!).slice(0, 8).map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => nav(jobHref(linkBase, r))}>
                    <td>{r.position.title}</td><td className="muted">{r.company.name}</td>
                    <td className="num">{fmt(r.result!.totalPoints)}</td><td className="num">{r.result!.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'grades' && <GradeGroups rows={rows} grades={gradeList} linkBase={linkBase} />}

      {tab === 'table' && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                {th('code', 'Code')}{th('role', 'Role')}{th('company', 'Company')}{th('department', 'Department')}
                {th('evaluator', 'Evaluators')}{th('status', 'Status')}{th('points', 'Points', true)}{th('grade', 'Grade', true)}<th>Profile</th><th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => nav(jobHref(linkBase, r))}>
                  <td>{r.position.code}</td>
                  <td>{r.position.title}<JobBadges j={r} /></td>
                  <td>{r.company.name}</td><td>{r.department.name}</td>
                  <td>{r.evaluators.map((e) => e.name).join(', ')}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num">{fmt(r.result?.totalPoints)}</td>
                  <td className="num">{r.result?.grade ?? '—'}</td>
                  <td>{r.result?.profile ?? '—'}</td>
                  <td className="small">{r.result?.complete ? [...r.result.checks, spreadFlag(r)].filter(Boolean).join('; ') || 'OK' : ''}</td>
                </tr>
              ))}
              {!tableRows.length && <tr><td colSpan={10} className="muted">No jobs match the current slicers.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
