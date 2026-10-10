import { type ReactNode, useRef } from 'react';

export interface ShellSection<K extends string> {
  key: K;
  label: string;
  /** Shows a tick once the section is complete. */
  done?: boolean;
  /** Shows ⚑ when the section has something to look at (evaluator flags). */
  flag?: boolean;
}

/**
 * The one layout every questionnaire uses (job holder, line manager, evaluator, reviewers):
 * progress bar, section tabs, the current section in a card, and Previous / Save & next.
 * Moving between sections saves first (unless read-only) and brings the section into view.
 */
export function QuestionnaireShell<K extends string>({
  sections,
  current,
  onGo,
  answered,
  total,
  progressLabel = 'questions answered',
  readOnly,
  scrollMargin = 12,
  children,
}: {
  sections: ShellSection<K>[];
  current: K;
  /** Switch section; the caller saves first when it needs to. */
  onGo: (key: K) => void | Promise<void>;
  answered: number;
  total: number;
  progressLabel?: string;
  readOnly?: boolean;
  /** Space kept above the questionnaire when scrolling to it (for sticky headers). */
  scrollMargin?: number;
  children: ReactNode;
}) {
  const top = useRef<HTMLDivElement>(null);
  const idx = sections.findIndex((s) => s.key === current);

  const go = async (key: K) => {
    await onGo(key);
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  };

  return (
    <div ref={top} style={{ scrollMarginTop: scrollMargin }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="progress" style={{ flex: 1 }} aria-label={progressLabel}>
          <div style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </div>
        <span className="small muted">{answered} of {total} {progressLabel}</span>
      </div>
      <div className="section-nav" role="tablist">
        {sections.map((s) => (
          <button key={s.key} role="tab" aria-selected={current === s.key} className={`choice${current === s.key ? ' on' : ''}`} onClick={() => go(s.key)}>
            {s.done && current !== s.key ? '✓ ' : ''}{s.label}{s.flag ? ' ⚑' : ''}
          </button>
        ))}
      </div>

      <div className="card">
        {children}
        <div className="row spread" style={{ marginTop: 16 }}>
          <button disabled={idx <= 0} onClick={() => go(sections[idx - 1].key)}>← Previous</button>
          {idx < sections.length - 1 && (
            <button className="primary" onClick={() => go(sections[idx + 1].key)}>{readOnly ? 'Next' : 'Save & next'} →</button>
          )}
        </div>
      </div>
    </div>
  );
}
