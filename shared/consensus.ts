/**
 * Consensus across several evaluators' levels for the same job.
 *
 * For each element the most common level wins. When an element is tied, the
 * tie is resolved so the consensus total stays closest to the median of the
 * evaluators' totals. Resolving ties element by element in isolation (e.g.
 * always "lower") can push the total below or above every evaluator. Any
 * remaining tie goes to the level closest to that element's median rating,
 * then to the lower level.
 */
import {
  BREADTHS,
  CHALLENGES,
  EMPTY_INPUTS,
  type EvaluationInputs,
  HUMAN_RELATIONS,
  IMPACTS,
  LETTERS,
  MAGNITUDES,
  accountabilityPoints,
  knowHowPoints,
  problemSolvingPercent,
  problemSolvingPoints,
} from './engine';

export type ElementKey = keyof EvaluationInputs;

/** Each element's levels in ascending order. */
export const ELEMENT_ORDER: Record<ElementKey, readonly string[]> = {
  khTechnical: LETTERS,
  khBreadth: BREADTHS,
  khHumanRelations: HUMAN_RELATIONS,
  khShade: ['-', '', '+'],
  psEnvironment: LETTERS,
  psChallenge: CHALLENGES,
  psPick: ['Low', 'High'],
  acFreedom: LETTERS,
  acMagnitude: MAGNITUDES,
  acImpact: IMPACTS,
  acShade: ['-', '', '+'],
};

export const ELEMENT_LABEL: Record<ElementKey, string> = {
  khTechnical: 'KH · Technical',
  khBreadth: 'KH · Managerial breadth',
  khHumanRelations: 'KH · Human relations',
  khShade: 'KH · Shading',
  psEnvironment: 'PS · Thinking environment',
  psChallenge: 'PS · Thinking challenge',
  psPick: 'PS · % pick',
  acFreedom: 'AC · Freedom to act',
  acMagnitude: 'AC · Magnitude',
  acImpact: 'AC · Impact',
  acShade: 'AC · Shading',
};

export const ELEMENT_KEYS = Object.keys(ELEMENT_ORDER) as ElementKey[];

export interface ElementConsensus {
  level: string;
  /** Levels that shared the top vote count, when more than one did. */
  tiedWith: string[];
  /** How many ratings chose the consensus level. */
  votes: number;
  /** How many ratings this element had (impact excludes magnitude-N ratings). */
  total: number;
  /** Count per level, for every level chosen at least once. */
  distribution: Record<string, number>;
  /** True when the ratings are not unanimous. */
  disagreement: boolean;
}

export interface Consensus {
  inputs: EvaluationInputs;
  elements: Record<ElementKey, ElementConsensus>;
  raters: number;
}

function pick(key: ElementKey, values: string[]): ElementConsensus {
  const order = ELEMENT_ORDER[key];
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  let tied = Object.keys(counts).filter((v) => counts[v] === max);
  if (tied.length > 1) {
    const idx = values.map((v) => order.indexOf(v)).sort((a, b) => a - b);
    const median = idx.length % 2 ? idx[(idx.length - 1) / 2] : (idx[idx.length / 2 - 1] + idx[idx.length / 2]) / 2;
    tied = tied.sort((a, b) => {
      const d = Math.abs(order.indexOf(a) - median) - Math.abs(order.indexOf(b) - median);
      return d !== 0 ? d : order.indexOf(a) - order.indexOf(b);
    });
  }
  return {
    level: tied[0] ?? '',
    tiedWith: tied.length > 1 ? tied : [],
    votes: max,
    total: values.length,
    distribution: counts,
    disagreement: Object.keys(counts).length > 1,
  };
}

/** Builds the consensus from complete ratings. Returns null when there are none. */
export function buildConsensus(ratings: EvaluationInputs[]): Consensus | null {
  if (!ratings.length) return null;
  const elements = {} as Record<ElementKey, ElementConsensus>;
  for (const key of ELEMENT_KEYS) {
    if (key === 'acImpact') continue;
    elements[key] = pick(key, ratings.map((r) => r[key] as string));
  }
  // Impact only counts ratings that used a magnitude other than N.
  const impactRatings = ratings.filter((r) => r.acMagnitude !== 'N').map((r) => r.acImpact as string);
  elements.acImpact =
    elements.acMagnitude.level === 'N'
      ? { level: '', tiedWith: [], votes: 0, total: 0, distribution: {}, disagreement: false }
      : pick('acImpact', impactRatings);

  const inputs = { ...EMPTY_INPUTS } as Record<ElementKey, string>;
  for (const key of ELEMENT_KEYS) inputs[key] = elements[key].level;
  resolveTies(inputs, elements, ratings);
  return { inputs: inputs as unknown as EvaluationInputs, elements, raters: ratings.length };
}

/** Hay total for a set of levels, or null if incomplete. */
export function totalPoints(i: EvaluationInputs): number | null {
  const kh = knowHowPoints(i);
  const pct = kh === null ? null : problemSolvingPercent(i);
  const ac = accountabilityPoints(i);
  if (kh === null || pct === null || ac === null) return null;
  return kh + problemSolvingPoints(kh, pct) + ac;
}

const MAX_COMBINATIONS = 4096;

/** Picks, among tied levels, the combination whose total is closest to the evaluators' median total. */
function resolveTies(inputs: Record<ElementKey, string>, elements: Record<ElementKey, ElementConsensus>, ratings: EvaluationInputs[]) {
  const tiedKeys = ELEMENT_KEYS.filter((k) => elements[k].tiedWith.length > 1);
  const combos = tiedKeys.reduce((n, k) => n * elements[k].tiedWith.length, 1);
  if (!tiedKeys.length || combos > MAX_COMBINATIONS) return;
  const totals = ratings.map(totalPoints).filter((t): t is number => t !== null).sort((a, b) => a - b);
  if (!totals.length) return;
  const mid = totals.length % 2 ? totals[(totals.length - 1) / 2] : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2;

  let best: { choice: string[]; gap: number; rank: number } | null = null;
  for (let c = 0; c < combos; c++) {
    let rest = c;
    let rank = 0;
    const choice = tiedKeys.map((k) => {
      const opts = elements[k].tiedWith; // already ordered by the per-element tie rule
      const idx = rest % opts.length;
      rest = Math.floor(rest / opts.length);
      rank += idx;
      return opts[idx];
    });
    const trial = { ...inputs } as Record<ElementKey, string>;
    tiedKeys.forEach((k, i) => (trial[k] = choice[i]));
    const t = totalPoints(trial as unknown as EvaluationInputs);
    if (t === null) continue;
    const gap = Math.abs(t - mid);
    if (!best || gap < best.gap || (gap === best.gap && rank < best.rank)) best = { choice, gap, rank };
  }
  if (best) {
    tiedKeys.forEach((k, i) => {
      inputs[k] = best!.choice[i];
      elements[k].level = best!.choice[i];
      elements[k].votes = elements[k].distribution[best!.choice[i]] ?? elements[k].votes;
    });
    if (inputs.acMagnitude === 'N') {
      inputs.acImpact = '';
      elements.acImpact.level = '';
    }
  }
}
