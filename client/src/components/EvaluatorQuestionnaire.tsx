import { useMemo, useState } from 'react';
import {
  type ElementId,
  type EvaluatorQuestionnaire as EvQ,
  JOB_INFO_FIELDS,
  type MagnitudeWorksheet,
  QUESTIONNAIRE,
  type QuestionnaireResult,
  consolidate,
  magnitudeFromUsd,
} from '../../../shared/questionnaire';
import { LEVEL_DEFINITIONS } from '../../../shared/engine';
import { RESPONDENT_ROLE_LABEL, type Respondent } from '../api';
import { QuestionBlock } from './QuestionBlock';
import { QuestionnaireShell, type ShellSection } from './QuestionnaireShell';
import { fmt, fmtDate } from './ui';

const STATUS_TEXT = { invited: 'Not started', in_progress: 'In progress', submitted: 'Submitted' } as const;
const SHADE_TEXT = { '': 'none', '+': '+', '-': '−' } as const;

/** Live consolidation of a draft with the submitted JH / LM responses. */
export function useConsolidated(draft: EvQ, respondents: Respondent[]): QuestionnaireResult {
  return useMemo(() => {
    const done = respondents.filter((r) => r.status === 'submitted' && r.answers);
    return consolidate(draft, done.filter((r) => r.role === 'JH').map((r) => r.answers!), done.filter((r) => r.role === 'LM').map((r) => r.answers!));
  }, [draft, respondents]);
}

export function RespondentsCard({ respondents }: { respondents: Respondent[] }) {
  const jh = respondents.filter((r) => r.role === 'JH');
  return (
    <div className="card">
      <h2>Respondents</h2>
      {!respondents.length && <p className="muted small">No job holder or line manager has been asked. Your ratings alone set the levels.</p>}
      <table>
        <tbody>
          {respondents.map((r) => (
            <tr key={r.id}>
              <td>{RESPONDENT_ROLE_LABEL[r.role]}</td>
              <td>{r.name}</td>
              <td>
                <span className={`badge ${r.status === 'submitted' ? 'b-approved' : r.status === 'in_progress' ? 'b-in_progress' : 'b-assigned'}`}>{STATUS_TEXT[r.status]}</span>
                {r.status === 'submitted' && <span className="small muted"> {fmtDate(r.submittedAt)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 8 }}>
        Each question takes the middle value of the job holder, line manager and your rating. Where only two ratings exist, your rating is used
        {jh.length === 0 ? ', so with no job holder taking part your ratings decide' : ''}. Only submitted responses count.
      </p>
      {respondents.filter((r) => r.status === 'submitted').map((r) => (
        <details key={r.id} style={{ marginTop: 8 }}>
          <summary className="small"><strong>{r.name}</strong> ({RESPONDENT_ROLE_LABEL[r.role].toLowerCase()}): job information and most complex problem</summary>
          <div className="small" style={{ marginTop: 6 }}>
            {JOB_INFO_FIELDS.filter((f) => r.jobInfo?.[f.key]).map((f) => (
              <p key={f.key} style={{ margin: '2px 0' }}><strong>{f.label}:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{r.jobInfo![f.key]}</span></p>
            ))}
            {r.complexProblem && <p style={{ margin: '6px 0 0' }}><strong>Most complex problem:</strong> {r.complexProblem}</p>}
            {!JOB_INFO_FIELDS.some((f) => r.jobInfo?.[f.key]) && !r.complexProblem && <span className="muted">Nothing entered.</span>}
          </div>
        </details>
      ))}
    </div>
  );
}

type Section = ElementId | 'AC_M' | 'summary';

/** The evaluator's questionnaire: EV column, scoring boxes, magnitude worksheet and summary. */
export function EvaluatorQuestionnaire({
  value,
  onChange,
  respondents,
  readOnly,
  onSave,
  onSubmit,
  canSubmit,
  busy,
  scrollMargin,
}: {
  value: EvQ;
  onChange?: (next: EvQ) => void;
  respondents: Respondent[];
  readOnly?: boolean;
  /** Saves the draft quietly; called when moving to another section. */
  onSave?: () => Promise<void>;
  /** Saves and submits the evaluation (last section). */
  onSubmit?: () => void;
  canSubmit?: boolean;
  busy?: boolean;
  scrollMargin?: number;
}) {
  const [section, setSection] = useState<Section>(readOnly ? 'summary' : 'KH_T');
  const result = useConsolidated(value, respondents);
  const set = (patch: Partial<EvQ>) => onChange?.({ ...value, ...patch });
  const el = QUESTIONNAIRE.find((x) => x.id === section);
  const complexStories = respondents.filter((r) => r.status === 'submitted' && r.complexProblem);

  const sections: ShellSection<Section>[] = [
    ...QUESTIONNAIRE.map((x) => {
      const r = result.elements[x.id];
      return { key: x.id as Section, label: x.code, done: r.complete && !r.overrideError, flag: r.spreadFlag || r.divergentQuestions.length > 0 };
    }),
    { key: 'AC_M', label: 'AC-M Magnitude', done: !!value.magnitude.level },
    { key: 'summary', label: readOnly ? 'Summary' : 'Review & submit', done: result.complete },
  ];
  const total = QUESTIONNAIRE.reduce((n, x) => n + x.questions.length, 0);
  const answered = QUESTIONNAIRE.reduce((n, x) => n + x.questions.filter((qu) => value.answers[qu.id]).length, 0);
  const go = async (key: Section) => {
    if (!readOnly && onSave) await onSave();
    setSection(key);
  };

  return (
    <QuestionnaireShell sections={sections} current={section} onGo={go} answered={answered} total={total}
      progressLabel={readOnly ? 'questions rated by the evaluator' : 'questions rated'} readOnly={readOnly} scrollMargin={scrollMargin}>

      {el && (() => {
        const r = result.elements[el.id];
        const ov = value.overrides[el.id];
        return (
          <div>
            <h3>{el.code} · {el.name}</h3>
            <p className="muted small">{el.intro}</p>
            <div className="legend">
              <span><span className="marker m-JH">JH</span> job holder{respondents.filter((x) => x.role === 'JH' && x.status === 'submitted').length > 1 ? 's (median)' : ''}</span>
              <span><span className="marker m-LM">LM</span> line manager</span>
              <span>Highlighted: your rating · green edge: consolidated level</span>
            </div>
            {el.questions.map((qu, i) => {
              const qr = r.questions[i];
              return (
                <div key={qu.id}>
                  {qu.evaluatorOnly && complexStories.length > 0 && (
                    <div className="score-box small">
                      {complexStories.map((c) => <p key={c.id} style={{ margin: '2px 0' }}><strong>{c.name} ({c.role}):</strong> {c.complexProblem}</p>)}
                    </div>
                  )}
                  <QuestionBlock
                    number={i + 1}
                    question={qu}
                    codes={el.codes}
                    value={value.answers[qu.id]}
                    readOnly={readOnly}
                    onChange={(v) => set({ answers: { ...value.answers, [qu.id]: v } })}
                    markers={[
                      { label: 'JH', value: qr.jh, title: qr.jhCount > 1 ? `Median of ${qr.jhCount} job holders` : 'Job holder' },
                      { label: 'LM', value: qr.lm, title: 'Line manager' },
                    ]}
                    consolidated={qr.consolidated}
                  />
                  {qr.divergent && <div className="flag small">⚑ Job holder and line manager are {Math.abs(qr.jh! - qr.lm!)} levels apart: explore in the interview.</div>}
                </div>
              );
            })}

            <div className="score-box">
              <strong>{el.code} scoring box</strong>
              <table style={{ marginTop: 6 }}>
                <thead><tr><th>Question</th><th className="num">Weight</th><th className="num">Consolidated</th><th className="num">Weight × level</th></tr></thead>
                <tbody>
                  {el.questions.map((qu, i) => {
                    const c = r.questions[i].consolidated;
                    return (
                      <tr key={qu.id}>
                        <td className="small">Q{i + 1} {qu.text}</td>
                        <td className="num">{qu.weight}</td>
                        <td className="num">{c == null ? '—' : `${el.codes[c - 1]} (${c})`}</td>
                        <td className="num">{c == null ? '—' : qu.weight * c}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {r.complete ? (
                <p className="small" style={{ margin: '8px 0 0' }}>
                  Weighted average <strong>{r.weightedAverage!.toFixed(2)}</strong> → level <strong>{el.codes[r.computedLevel! - 1]}</strong>
                  {' '}· deviation {r.deviation! >= 0 ? '+' : ''}{r.deviation!.toFixed(2)} → shade <strong>{SHADE_TEXT[r.computedShade]}</strong>
                  {!el.shadeUsed && r.computedShade && <span className="muted"> (recorded for the panel only)</span>}
                  {el.id === 'PS_C' && <span className="muted"> · shade “+” selects the higher Problem Solving percentage</span>}
                </p>
              ) : (
                <p className="small muted" style={{ margin: '8px 0 0' }}>Rate every question to see the result.</p>
              )}
              {r.spreadFlag && <div className="flag small">⚑ Spread: consolidated levels span more than {el.spreadLimit} level{el.spreadLimit > 1 ? 's' : ''}.</div>}
              {r.divergentQuestions.length > 0 && <div className="flag small">⚑ Rater divergence on {r.divergentQuestions.map((x) => 'Q' + x.split('.')[1]).join(', ')}.</div>}

              {r.complete && (
                <div style={{ marginTop: 8 }}>
                  <label className="row small">
                    <input type="checkbox" disabled={readOnly} checked={!!ov}
                      onChange={(e) => {
                        const overrides = { ...value.overrides };
                        if (e.target.checked) overrides[el.id] = { level: r.computedLevel!, shade: r.computedShade, rationale: '' };
                        else delete overrides[el.id];
                        set({ overrides });
                      }} />
                    Override the level (by one step at most, with a rationale)
                  </label>
                  {ov && (
                    <div className="form-grid" style={{ marginTop: 6 }}>
                      <label className="field">Level
                        <select disabled={readOnly} value={ov.level} onChange={(e) => set({ overrides: { ...value.overrides, [el.id]: { ...ov, level: Number(e.target.value) } } })}>
                          {el.codes.map((c, i) => (Math.abs(i + 1 - r.computedLevel!) <= 1 ? <option key={c} value={i + 1}>{c}</option> : null))}
                        </select>
                      </label>
                      {el.shadeUsed && (
                        <label className="field">Shade
                          <select disabled={readOnly} value={ov.shade} onChange={(e) => set({ overrides: { ...value.overrides, [el.id]: { ...ov, shade: e.target.value as '' | '+' | '-' } } })}>
                            <option value="">none</option><option value="+">+</option><option value="-">−</option>
                          </select>
                        </label>
                      )}
                      <label className="field" style={{ gridColumn: '1 / -1' }}>Rationale
                        <input disabled={readOnly} value={ov.rationale} onChange={(e) => set({ overrides: { ...value.overrides, [el.id]: { ...ov, rationale: e.target.value } } })} placeholder="Why the panel moves this level" />
                      </label>
                    </div>
                  )}
                  {r.overrideError && <div className="alert error small" style={{ marginTop: 6 }}>{r.overrideError}</div>}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {section === 'AC_M' && <MagnitudeEditor value={value.magnitude} readOnly={readOnly} onChange={(magnitude) => set({ magnitude })} />}

      {section === 'summary' && (
        <div>
          <QuestionnaireSummary result={result} magnitude={value.magnitude} />
          {!readOnly && onSubmit && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" disabled={busy || !canSubmit} onClick={onSubmit}>Submit for review</button>
              <span className="small muted">
                {canSubmit ? 'After submitting, the evaluation goes to management and can no longer be changed.' : 'Rate every question, set the magnitude and justify any override to submit.'}
              </span>
            </div>
          )}
        </div>
      )}
    </QuestionnaireShell>
  );
}

function MagnitudeEditor({ value, onChange, readOnly }: { value: MagnitudeWorksheet; onChange: (v: MagnitudeWorksheet) => void; readOnly?: boolean }) {
  const primary = value.primary !== null ? value.figures[value.primary] : undefined;
  const suggested = primary ? magnitudeFromUsd(primary.usd) : null;
  const setFig = (i: number, patch: Partial<MagnitudeWorksheet['figures'][number]>) =>
    onChange({ ...value, figures: value.figures.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="stack">
      <div>
        <h3>AC-M · Magnitude worksheet</h3>
        <p className="muted small">
          The annual financial size of the area the job most clearly affects, set from facts (latest full-year budget or actuals), not averaged from opinions.
          Prefer a measure the job affects directly over a larger one it only advises on. Advisory or research jobs with no meaningful figure take level N, and Impact is then not scored.
        </p>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Measure</th><th>Annual value (USD)</th><th>Local currency</th><th>Job’s influence</th><th>Primary</th></tr></thead>
          <tbody>
            {value.figures.map((f, i) => (
              <tr key={i}>
                <td>{f.measure}</td>
                <td><input type="number" min={0} disabled={readOnly} value={f.usd ?? ''} style={{ width: 140 }} onChange={(e) => setFig(i, { usd: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td><input disabled={readOnly} value={f.local} style={{ width: 140 }} onChange={(e) => setFig(i, { local: e.target.value })} /></td>
                <td>
                  <select disabled={readOnly} value={f.influence} onChange={(e) => setFig(i, { influence: e.target.value as typeof f.influence })}>
                    <option value="">—</option><option value="direct">Direct</option><option value="shared">Shared</option><option value="advisory">Advisory</option>
                  </select>
                </td>
                <td><input type="radio" name="primary" disabled={readOnly} checked={value.primary === i} onChange={() => onChange({ ...value, primary: i })} aria-label={`Primary: ${f.measure}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {primary && (
        <p className="small">
          Primary measure: <strong>{primary.measure}</strong>{primary.usd != null ? `, USD ${fmt(primary.usd)}` : ''} → suggested level <strong>{suggested}</strong>
          {!readOnly && suggested && suggested !== value.level && <button className="ghost" onClick={() => onChange({ ...value, level: suggested })}>Use {suggested}</button>}
        </p>
      )}
      <div className="form-grid">
        <label className="field">Magnitude level
          <select disabled={readOnly} value={value.level} onChange={(e) => onChange({ ...value, level: e.target.value as MagnitudeWorksheet['level'] })}>
            <option value="">Choose…</option>
            {Object.entries(LEVEL_DEFINITIONS.acMagnitude).map(([k, d]) => <option key={k} value={k}>{k} · {d}</option>)}
          </select>
        </label>
        <label className="field">Source of figure (budget / actuals, year)
          <input disabled={readOnly} value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

/** Part 6: element results carried to the job score. */
export function QuestionnaireSummary({ result, magnitude }: { result: QuestionnaireResult; magnitude: MagnitudeWorksheet }) {
  return (
    <div className="table-wrap">
      <h3>Consolidated evaluation summary</h3>
      <table>
        <thead><tr><th>Element</th><th className="num">Weighted avg</th><th>Final level</th><th>Shade</th><th>Flags</th></tr></thead>
        <tbody>
          {QUESTIONNAIRE.map((el) => {
            const r = result.elements[el.id];
            const flags = [r.spreadFlag && 'spread', r.divergentQuestions.length && `JH/LM divergence (${r.divergentQuestions.length})`, r.overridden && 'overridden', r.overrideError].filter(Boolean);
            return (
              <tr key={el.id}>
                <td>{el.code} · {el.name}</td>
                <td className="num">{r.weightedAverage?.toFixed(2) ?? '—'}</td>
                <td><strong>{r.finalCode ?? '—'}</strong></td>
                <td>{r.complete ? (el.shadeUsed ? SHADE_TEXT[r.finalShade] : <span className="muted">{SHADE_TEXT[r.computedShade]} (panel only)</span>) : '—'}</td>
                <td className="small flag">{flags.join('; ')}</td>
              </tr>
            );
          })}
          <tr>
            <td>AC-M · Magnitude</td><td className="num muted">n/a</td><td><strong>{magnitude.level || '—'}</strong></td><td /><td className="small muted">{magnitude.source}</td>
          </tr>
        </tbody>
      </table>
      {!result.complete && (
        <p className="small muted" style={{ marginTop: 8 }}>
          {result.missing.length ? `${result.missing.length} question(s) still need your rating. ` : ''}
          {!magnitude.level ? 'Set the magnitude level. ' : ''}
          {QUESTIONNAIRE.some((el) => result.elements[el.id].overrideError) ? 'Fix the override errors.' : ''}
        </p>
      )}
    </div>
  );
}
