import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PayTable } from '../../../shared/pay';
import type { GradeBand, JobRecord } from '../api';
import { JobBadges, jobHref, spreadFlag } from './JobBits';
import { StatusBadge, fmt } from './ui';

type SubGroup = 'none' | 'company' | 'department';

/** Positions grouped into the grades of the current structure. */
export function GradeGroups({
  rows,
  grades,
  payTable,
  linkBase,
}: {
  rows: JobRecord[];
  grades: GradeBand[];
  /** Salary bands of the structure, if it has them. */
  payTable?: PayTable | null;
  /** Panel root, e.g. "/admin". */
  linkBase: string;
}) {
  const [sub, setSub] = useState<SubGroup>('none');
  const [showEmpty, setShowEmpty] = useState(false);
  const scored = rows.filter((r) => r.result?.complete);
  const max = Math.max(1, ...grades.map((g) => scored.filter((r) => r.result!.grade === g.grade).length));
  const sorted = [...grades].sort((a, b) => b.minPoints - a.minPoints);

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="row">
          <label className="field">
            Sub-group positions by
            <select value={sub} onChange={(e) => setSub(e.target.value as SubGroup)}>
              <option value="none">Nothing</option>
              <option value="company">Company</option>
              <option value="department">Department</option>
            </select>
          </label>
          <label className="row small" style={{ marginTop: 18 }}>
            <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show empty grades
          </label>
        </div>
        <span className="muted small">
          {scored.length} scored job{scored.length === 1 ? '' : 's'} · {rows.length - scored.length} not yet scored
        </span>
      </div>

      {sorted.map((g, i) => {
        const upper = i === 0 ? null : sorted[i - 1].minPoints - 1;
        const zone = payTable?.zones.find((z) => z.grade === g.grade);
        const items = scored
          .filter((r) => r.result!.grade === g.grade)
          .sort((a, b) => b.result!.totalPoints! - a.result!.totalPoints!);
        if (!items.length && !showEmpty) return null;
        const groups = new Map<string, JobRecord[]>();
        for (const it of items) {
          const k = sub === 'company' ? it.company.name : sub === 'department' ? `${it.department.name} · ${it.company.name}` : '';
          groups.set(k, [...(groups.get(k) ?? []), it]);
        }
        return (
          <details className="grade-group" key={g.grade} open={items.length > 0 && items.length <= 12}>
            <summary>
              <span className="grade-pill">G{g.grade}</span>
              <span style={{ minWidth: 120 }} className="num">
                {fmt(g.minPoints)}–{upper === null ? '+' : fmt(upper)} pts
              </span>
              <span style={{ flex: 1 }}>
                {g.careerLevel || <span className="muted">—</span>}
                {g.typicalRoles && <span className="muted small"> · {g.typicalRoles}</span>}
                {zone && (
                  <span className="small" style={{ display: 'block' }}>
                    <span className="badge b-neutral">{zone.band} · {zone.cadre}</span>{' '}
                    <span className="muted">{payTable!.currency} {fmt(zone.zoneMin)}–{fmt(zone.zoneMax)} (band {fmt(zone.bandMin)}–{fmt(zone.bandMax)})</span>
                  </span>
                )}
              </span>
              <div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${(items.length / max) * 100}%` }} /></div>
              <strong className="num" style={{ minWidth: 70 }}>{items.length} job{items.length === 1 ? '' : 's'}</strong>
            </summary>
            {items.length > 0 && (
              <div className="body table-wrap">
                {[...groups.entries()].map(([k, list]) => (
                  <div key={k}>
                    {k && <h3 style={{ marginTop: 10 }}>{k} <span className="muted small">({list.length})</span></h3>}
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th><th>Role</th><th>Company</th><th>Department</th>
                          <th className="num">Points</th><th>Profile</th><th>Status</th><th>Checks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.id}>
                            <td><Link to={jobHref(linkBase, r)}>{r.position.code}</Link></td>
                            <td>{r.position.title}<JobBadges j={r} /></td>
                            <td>{r.company.name}</td>
                            <td>{r.department.name}</td>
                            <td className="num">{fmt(r.result!.totalPoints)}</td>
                            <td>{r.result!.profile}</td>
                            <td><StatusBadge status={r.status} /></td>
                            <td className="small">{[...r.result!.checks, spreadFlag(r)].filter(Boolean).join('; ') || 'OK'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </details>
        );
      })}
      {scored.length === 0 && <div className="card muted">No scored evaluations match the current slicers.</div>}
    </div>
  );
}
