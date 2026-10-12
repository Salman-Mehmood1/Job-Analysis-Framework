import type { OrgUser, Role } from '../api';

const ROLE_HINT: Record<Role, string> = { admin: 'administrator', management: 'management', evaluator: 'evaluator', respondent: '' };
const label = (u: OrgUser) => `${u.name}${ROLE_HINT[u.role] ? ` (${ROLE_HINT[u.role]})` : ''}`;

export interface PeopleChoice {
  lineManagerId: number | null;
  jobHolderIds: number[];
}

/**
 * Line manager (one) and job holders (optional, any number) of a position. Any active user can be
 * chosen; `blocked` users (e.g. the job's evaluators) are left out because they cannot answer its questionnaire.
 */
export function PeoplePicker({
  users,
  value,
  onChange,
  blocked = [],
  compact = false,
}: {
  users: OrgUser[];
  value: PeopleChoice;
  onChange: (v: PeopleChoice) => void;
  blocked?: number[];
  compact?: boolean;
}) {
  const active = users.filter((u) => u.active && !blocked.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id: number) => users.find((u) => u.id === id)?.name ?? `User ${id}`;
  const addable = active.filter((u) => u.id !== value.lineManagerId && !value.jobHolderIds.includes(u.id));
  return (
    <div className={compact ? 'row' : 'stack'} style={{ gap: compact ? 6 : 8, alignItems: compact ? 'center' : undefined }}>
      <label className={compact ? 'row small' : 'field'} style={compact ? { gap: 4 } : undefined}>
        {compact ? 'LM' : 'Line manager'}
        <select value={value.lineManagerId ?? ''} aria-label="Line manager"
          onChange={(e) => onChange({ ...value, lineManagerId: e.target.value ? Number(e.target.value) : null, jobHolderIds: value.jobHolderIds.filter((x) => x !== Number(e.target.value)) })}>
          <option value="">{compact ? 'None' : 'Not set'}</option>
          {value.lineManagerId && !active.some((u) => u.id === value.lineManagerId) && <option value={value.lineManagerId}>{nameOf(value.lineManagerId)} (unavailable)</option>}
          {active.map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}
        </select>
      </label>
      <div className={compact ? 'row small' : 'field'} style={compact ? { gap: 4 } : undefined}>
        {compact ? 'JH' : 'Job holders (optional)'}
        <div className="row" style={{ gap: 4 }}>
          {value.jobHolderIds.map((id) => (
            <span key={id} className="chip">
              {nameOf(id)}
              <button className="ghost" aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange({ ...value, jobHolderIds: value.jobHolderIds.filter((x) => x !== id) })}>×</button>
            </span>
          ))}
          <select value="" aria-label="Add job holder" onChange={(e) => e.target.value && onChange({ ...value, jobHolderIds: [...value.jobHolderIds, Number(e.target.value)] })}>
            <option value="">+ Add{compact ? '' : ' job holder'}</option>
            {addable.map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

export const peopleOfPosition = (p: { lineManager: { id: number } | null; jobHolders: { id: number }[] } | undefined): PeopleChoice => ({
  lineManagerId: p?.lineManager?.id ?? null,
  jobHolderIds: p?.jobHolders.map((j) => j.id) ?? [],
});
