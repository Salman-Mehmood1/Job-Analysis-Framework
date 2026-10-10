import { describe, expect, it } from 'vitest';
import {
  type Answers,
  EMPTY_EV_QUESTIONNAIRE,
  type EvaluatorQuestionnaire,
  QUESTIONNAIRE,
  RESPONDENT_QUESTIONS,
  consolidate,
  magnitudeFromUsd,
} from '../shared/questionnaire';
import { evaluate, DEFAULT_GRADES } from '../shared/engine';

/** Every question of an element answered with the given levels (Q1..Q5). */
const el = (id: string, levels: number[]): Answers => Object.fromEntries(levels.map((v, i) => [`${id}.${i + 1}`, v]));
const allAt = (levels: Record<string, number>): Answers =>
  Object.assign({}, ...QUESTIONNAIRE.map((e) => el(e.id, Array(5).fill(levels[e.id]))));

const ev = (answers: Answers, extra: Partial<EvaluatorQuestionnaire> = {}): EvaluatorQuestionnaire => ({
  ...EMPTY_EV_QUESTIONNAIRE,
  answers,
  magnitude: { ...EMPTY_EV_QUESTIONNAIRE.magnitude, level: '3' },
  ...extra,
});

describe('questionnaire pack', () => {
  it('has 7 questionnaires of 5 questions whose weights total 10', () => {
    expect(QUESTIONNAIRE).toHaveLength(7);
    for (const e of QUESTIONNAIRE) {
      expect(e.questions).toHaveLength(5);
      expect(e.questions.reduce((s, q) => s + q.weight, 0)).toBe(10);
      for (const q of e.questions) expect(q.options).toHaveLength(e.codes.length);
    }
    expect(RESPONDENT_QUESTIONS).toHaveLength(34); // PS-C Q4 is evaluator-only
  });

  it('reproduces the worked example: KH-T Finance Manager = F, no shade (WA 5.8)', () => {
    const r = consolidate(ev({ ...allAt({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 4, AC_F: 5, AC_I: 2 }), ...el('KH_T', [6, 6, 6, 5, 5]) }), [], []);
    expect(r.elements.KH_T.weightedAverage).toBe(5.8);
    expect(r.elements.KH_T.finalCode).toBe('F');
    expect(r.elements.KH_T.finalShade).toBe('');
    expect(r.inputs.khTechnical).toBe('F');
    expect(r.inputs.khShade).toBe('');
  });

  it('gives F+ when the weighted average is 6.3', () => {
    // 3×7 + 3×6 + 2×6 + 1×6 + 1×6 = 63
    const r = consolidate(ev({ ...allAt({ KH_T: 6, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 4, AC_F: 5, AC_I: 2 }), ...el('KH_T', [7, 6, 6, 6, 6]) }), [], []);
    expect(r.elements.KH_T.weightedAverage).toBe(6.3);
    expect(r.inputs.khTechnical).toBe('F');
    expect(r.inputs.khShade).toBe('+');
  });

  it('takes the median of JH, LM and EV; uses EV when the job holder did not take part', () => {
    const base = allAt({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 });
    const withJh = consolidate(ev(base), [allAt({ KH_T: 7, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 })], [allAt({ KH_T: 6, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 })]);
    expect(withJh.elements.KH_T.questions[0]).toMatchObject({ jh: 7, lm: 6, ev: 5, consolidated: 6 });
    const noJh = consolidate(ev(base), [], [allAt({ KH_T: 7, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 })]);
    expect(noJh.elements.KH_T.questions[0].consolidated).toBe(5); // two ratings → EV value
    expect(noJh.complete).toBe(true);
  });

  it('uses only the evaluator for PS-C Q4 and the median of several job holders', () => {
    const base = allAt({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 });
    const jh1 = { ...base, 'PS_C.4': 5, 'KH_T.1': 4 };
    const jh2 = { ...base, 'PS_C.4': 5, 'KH_T.1': 6 };
    const jh3 = { ...base, 'PS_C.4': 5, 'KH_T.1': 8 };
    const r = consolidate(ev(base), [jh1, jh2, jh3], [base]);
    expect(r.elements.PS_C.questions[3]).toMatchObject({ jh: null, lm: null, consolidated: 3 });
    expect(r.elements.KH_T.questions[0]).toMatchObject({ jh: 6, jhCount: 3 });
  });

  it('flags rater divergence and element spread', () => {
    const base = allAt({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 });
    const r = consolidate(
      ev({ ...base, ...el('KH_B', [1, 3, 3, 3, 3]) }),
      [{ ...base, 'AC_F.2': 2 }],
      [{ ...base, 'AC_F.2': 6 }],
    );
    expect(r.elements.AC_F.divergentQuestions).toEqual(['AC_F.2']);
    // JH and LM both said 3, so the median absorbs the evaluator's 1: no spread
    expect(r.elements.KH_B.spreadFlag).toBe(false);
    const spread = consolidate(ev({ ...base, ...el('KH_B', [1, 3, 3, 3, 3]) }), [], []);
    expect(spread.elements.KH_B.spreadFlag).toBe(true); // range 2 on a 5-level scale (limit 1)
    expect(spread.elements.KH_T.spreadFlag).toBe(false);
  });

  it('maps PS-C shade "+" to the higher Problem Solving percentage', () => {
    // 3×4 + 2×4 + 2×3 + 2×3 + 1×3 = 35 → WA 3.5 → level 4, deviation −0.5 → "−"; 3×3+2×4+2×4+2×3+1×3 = 34 → 3.4 → 3, +0.4 → "+"
    const base = allAt({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 });
    const r = consolidate(ev({ ...base, ...el('PS_C', [3, 4, 4, 3, 3]) }), [], []);
    expect(r.inputs.psChallenge).toBe('3');
    expect(r.inputs.psPick).toBe('High');
  });

  it('allows an override of one level with a rationale only', () => {
    const base = allAt({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 3, AC_F: 5, AC_I: 2 });
    const two = consolidate(ev(base, { overrides: { KH_T: { level: 7, shade: '', rationale: 'x' } } }), [], []);
    expect(two.elements.KH_T.overrideError).toMatch(/one step/);
    expect(two.complete).toBe(false);
    const noReason = consolidate(ev(base, { overrides: { KH_T: { level: 6, shade: '', rationale: ' ' } } }), [], []);
    expect(noReason.elements.KH_T.overrideError).toMatch(/rationale/);
    const ok = consolidate(ev(base, { overrides: { KH_T: { level: 6, shade: '-', rationale: 'Benchmarked against FIN-10' } } }), [], []);
    expect(ok.inputs.khTechnical).toBe('F');
    expect(ok.inputs.khShade).toBe('-');
    expect(ok.elements.KH_T.overridden).toBe(true);
  });

  it('feeds complete levels to the scoring engine; magnitude N drops impact', () => {
    const base = allAt({ KH_T: 6, KH_B: 3, KH_H: 2, PS_E: 5, PS_C: 4, AC_F: 5, AC_I: 2 });
    const r = consolidate(ev(base), [], []);
    expect(r.complete).toBe(true);
    expect(evaluate(r.inputs, DEFAULT_GRADES).totalPoints).toBe(1194); // the Finance Manager example
    const n = consolidate(ev(base, { magnitude: { ...EMPTY_EV_QUESTIONNAIRE.magnitude, level: 'N' } }), [], []);
    expect(n.inputs.acImpact).toBe('');
    expect(consolidate(ev({}), [], []).complete).toBe(false);
  });

  it('converts USD figures to magnitude levels', () => {
    expect([null, 0, 500_000, 5e6, 40e6, 250e6, 3e9].map(magnitudeFromUsd)).toEqual(['N', 'N', '1', '2', '3', '4', '5']);
  });
});
