import type { Question } from '../../../shared/questionnaire';

export interface Marker {
  label: 'JH' | 'LM' | 'EV';
  value: number | null;
  title?: string;
}

/**
 * One weighted questionnaire question: its level options, the current answer,
 * optional JH / LM markers (evaluator view) and the consolidated level.
 */
export function QuestionBlock({
  number,
  question,
  codes,
  value,
  onChange,
  readOnly,
  markers = [],
  consolidated,
  showWeight = true,
}: {
  number: number;
  question: Question;
  codes: readonly string[];
  value: number | undefined;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  markers?: Marker[];
  consolidated?: number | null;
  showWeight?: boolean;
}) {
  return (
    <div className="q-block" role="radiogroup" aria-label={`Q${number}. ${question.text}`}>
      <div className="q-head">
        <strong>Q{number}. {question.text}</strong>
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
          {showWeight && `Weight ${question.weight}`}
          {consolidated !== undefined && (
            <> · consolidated <strong>{consolidated == null ? '—' : codes[consolidated - 1]}</strong></>
          )}
        </span>
      </div>
      <div className="q-opts">
        {question.options.map((text, i) => {
          const v = i + 1;
          const on = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              className={`q-opt${on ? ' on' : ''}${consolidated === v ? ' consolidated' : ''}`}
              disabled={readOnly}
              onClick={() => onChange?.(v)}
            >
              <span className="code">{codes[i]}</span>
              <span>{text}</span>
              <span>
                {markers.filter((m) => m.value === v).map((m) => (
                  <span key={m.label} className={`marker m-${m.label}`} title={m.title}>{m.label}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
