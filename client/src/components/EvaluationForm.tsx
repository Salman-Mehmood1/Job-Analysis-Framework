import { useState } from 'react';
import {
  BREADTHS,
  CHALLENGES,
  type EvaluationInputs,
  type EvaluationResult,
  HUMAN_RELATIONS,
  IMPACTS,
  LETTERS,
  LEVEL_DEFINITIONS,
  MAGNITUDES,
} from '../../../shared/engine';
import { fmt } from './ui';

type Key = keyof EvaluationInputs;

interface ElementSpec {
  key: Key;
  label: string;
  options: readonly string[];
  defs?: Record<string, string>;
  /** Display text for option values, where it differs from the stored value. */
  optionLabels?: Record<string, string>;
}

/** Each environment × challenge combination allows two Problem Solving percentages. */
const PS_PERCENT_DEFS: Record<string, string> = {
  Low: 'Lower: the lower of the two Problem Solving percentages for this environment and challenge. The usual choice.',
  High: 'Higher: the higher percentage, for jobs at the top end of this environment and challenge (questionnaire: PS-C shade “+”).',
};

const FACTORS: { title: string; resultKey: 'khPoints' | 'psPoints' | 'acPoints'; elements: ElementSpec[] }[] = [
  {
    title: 'Know-How',
    resultKey: 'khPoints',
    elements: [
      { key: 'khTechnical', label: 'Technical / specialised know-how', options: LETTERS, defs: LEVEL_DEFINITIONS.khTechnical },
      { key: 'khBreadth', label: 'Managerial breadth', options: BREADTHS, defs: LEVEL_DEFINITIONS.khBreadth },
      { key: 'khHumanRelations', label: 'Human relations', options: HUMAN_RELATIONS, defs: LEVEL_DEFINITIONS.khHumanRelations },
      { key: 'khShade', label: 'Shading (one step up / down)', options: ['', '+', '-'] },
    ],
  },
  {
    title: 'Problem Solving',
    resultKey: 'psPoints',
    elements: [
      { key: 'psEnvironment', label: 'Thinking environment', options: LETTERS, defs: LEVEL_DEFINITIONS.psEnvironment },
      { key: 'psChallenge', label: 'Thinking challenge', options: CHALLENGES, defs: LEVEL_DEFINITIONS.psChallenge },
      { key: 'psPick', label: 'Problem Solving percentage', options: ['Low', 'High'], defs: PS_PERCENT_DEFS, optionLabels: { Low: 'Lower', High: 'Higher' } },
    ],
  },
  {
    title: 'Accountability',
    resultKey: 'acPoints',
    elements: [
      { key: 'acFreedom', label: 'Freedom to act', options: LETTERS, defs: LEVEL_DEFINITIONS.acFreedom },
      { key: 'acMagnitude', label: 'Magnitude (annual value affected)', options: MAGNITUDES, defs: LEVEL_DEFINITIONS.acMagnitude },
      { key: 'acImpact', label: 'Impact on magnitude', options: IMPACTS, defs: LEVEL_DEFINITIONS.acImpact },
      { key: 'acShade', label: 'Shading (one step up / down)', options: ['', '+', '-'] },
    ],
  },
];

const optionLabel = (o: string) => (o === '' ? 'none' : o);

export function EvaluationForm({
  inputs,
  onChange,
  readOnly,
  result,
  compareTo,
  compareLabel = 'was',
  reasons,
}: {
  inputs: EvaluationInputs;
  onChange?: (next: EvaluationInputs) => void;
  readOnly?: boolean;
  result: EvaluationResult | null;
  /** Show these levels as dashed outlines (e.g. the evaluator's original when management adjusts). */
  compareTo?: EvaluationInputs | null;
  /** Wording before the compared level, e.g. "was" or "you:". */
  compareLabel?: string;
  reasons?: Record<string, { level: string; reason: string }>;
}) {
  const [hover, setHover] = useState<{ key: Key; value: string } | null>(null);

  const set = (key: Key, value: string) => {
    if (readOnly || !onChange) return;
    const next = { ...inputs, [key]: value } as EvaluationInputs;
    if (key === 'acMagnitude' && value === 'N') next.acImpact = '';
    onChange(next);
  };

  return (
    <div className="grid grid-3">
      {FACTORS.map((f) => (
        <section className="factor" key={f.title}>
          <h3>
            <span>{f.title}</span>
            <span className="pts">{result?.[f.resultKey] != null ? `${fmt(result[f.resultKey])} pts` : '—'}</span>
          </h3>
          {f.title === 'Problem Solving' && result?.psPercent != null && (
            <div className="small muted">{result.psPercent}% of Know-How, rounded down to the scale</div>
          )}
          {f.elements.map((el) => {
            const disabledEl = el.key === 'acImpact' && inputs.acMagnitude === 'N';
            const current = inputs[el.key] as string;
            const shown = hover?.key === el.key ? hover.value : current;
            return (
              <div className="element" key={el.key}>
                <div className="element-label">
                  <span>{el.label}</span>
                  {compareTo && (compareTo[el.key] as string) !== current && (
                    <span className="flag">{compareLabel} {el.optionLabels?.[compareTo[el.key] as string] ?? optionLabel(compareTo[el.key] as string)}</span>
                  )}
                </div>
                <div className="choices" role="radiogroup" aria-label={el.label}>
                  {el.options.map((o) => {
                    const on = current === o;
                    const was = compareTo && (compareTo[el.key] as string) === o && !on;
                    return (
                      <button
                        key={o || 'none'}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`choice${on ? ' on' : ''}${was ? ' was' : ''}`}
                        disabled={readOnly || disabledEl}
                        onClick={() => set(el.key, o)}
                        onMouseEnter={() => setHover({ key: el.key, value: o })}
                        onMouseLeave={() => setHover(null)}
                        title={el.defs?.[o as keyof typeof el.defs]}
                      >
                        {el.optionLabels?.[o] ?? optionLabel(o)}
                      </button>
                    );
                  })}
                </div>
                {el.defs && (
                  <div className="def">
                    {disabledEl ? 'Not used when magnitude is N.' : shown ? (el.defs as Record<string, string>)[shown] : 'Choose a level.'}
                  </div>
                )}
                {reasons?.[el.key] && <div className="small" style={{ marginTop: 2 }}>↳ {reasons[el.key].reason}</div>}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function ResultStrip({ result }: { result: EvaluationResult | null }) {
  if (!result) return <div className="muted">No levels entered yet.</div>;
  return (
    <div>
      <div className="result-strip">
        <div className="kpi"><div className="label">Know-How</div><div className="value">{fmt(result.khPoints)}</div></div>
        <div className="kpi"><div className="label">Problem Solving</div><div className="value">{fmt(result.psPoints)}</div></div>
        <div className="kpi"><div className="label">Accountability</div><div className="value">{fmt(result.acPoints)}</div></div>
        <div className="kpi"><div className="label">Total points</div><div className="value">{fmt(result.totalPoints)}</div></div>
        <div className="kpi"><div className="label">Profile</div><div className="value">{result.profile ?? '—'}</div></div>
        <div className="kpi"><div className="label">Grade</div><div className="value">{result.grade ?? '—'}</div></div>
      </div>
      {result.complete && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted small">{result.careerLevel}</span>
          {result.checks.length === 0 ? (
            <span className="badge b-approved">Checks OK</span>
          ) : (
            result.checks.map((c) => <span key={c} className="badge b-submitted">{c}</span>)
          )}
        </div>
      )}
      {!result.complete && <div className="small muted" style={{ marginTop: 8 }}>Complete all three factors to see the total and grade.</div>}
    </div>
  );
}
