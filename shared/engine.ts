/**
 * Hay point-factor scoring engine.
 *
 * A direct port of the formulas in Job_Evaluation_Calculator.xlsx
 * (Evaluator, Scale and Grades & Bands sheets). Every lookup goes through the
 * 15% geometric point scale, exactly as the workbook does.
 */

/** Scale sheet, column B: geometric point series, ~15% per step. Index 0 = step 1. */
export const POINT_SCALE = [
  10, 12, 14, 16, 19, 22, 25, 29, 33, 38, 43, 50, 57, 66, 76, 87, 100, 115, 132, 152, 175, 200,
  230, 264, 304, 350, 400, 460, 528, 608, 700, 800, 920, 1056, 1216, 1400, 1600, 1840, 2112,
  2432, 2800,
] as const;

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const BREADTHS = ['T', 'I', 'II', 'III', 'IV'] as const;
export const HUMAN_RELATIONS = ['1', '2', '3'] as const;
export const CHALLENGES = ['1', '2', '3', '4', '5'] as const;
export const MAGNITUDES = ['N', '1', '2', '3', '4', '5'] as const;
export const IMPACTS = ['R', 'C', 'S', 'P'] as const;
export const SHADES = ['', '+', '-'] as const;
export const PS_PICKS = ['Low', 'High'] as const;

export type Letter = (typeof LETTERS)[number];
export type Breadth = (typeof BREADTHS)[number];
export type HumanRelations = (typeof HUMAN_RELATIONS)[number];
export type Challenge = (typeof CHALLENGES)[number];
export type Magnitude = (typeof MAGNITUDES)[number];
export type Impact = (typeof IMPACTS)[number];
export type Shade = (typeof SHADES)[number];
export type PsPick = (typeof PS_PICKS)[number];

/** The yellow input cells of one Evaluator row (columns D–N). */
export interface EvaluationInputs {
  khTechnical: Letter | '';
  khBreadth: Breadth | '';
  khHumanRelations: HumanRelations | '';
  khShade: Shade;
  psEnvironment: Letter | '';
  psChallenge: Challenge | '';
  psPick: PsPick;
  acFreedom: Letter | '';
  acMagnitude: Magnitude | '';
  acImpact: Impact | '';
  acShade: Shade;
}

export const EMPTY_INPUTS: EvaluationInputs = {
  khTechnical: '',
  khBreadth: '',
  khHumanRelations: '',
  khShade: '',
  psEnvironment: '',
  psChallenge: '',
  psPick: 'Low',
  acFreedom: '',
  acMagnitude: '',
  acImpact: '',
  acShade: '',
};

/** One row of the Grades & Bands sheet. */
export interface GradeBand {
  grade: number;
  minPoints: number;
  careerLevel: string;
  typicalRoles: string;
}

export interface EvaluationResult {
  complete: boolean;
  khPoints: number | null;
  psPercent: number | null;
  psPoints: number | null;
  acPoints: number | null;
  totalPoints: number | null;
  profile: string | null;
  grade: number | null;
  careerLevel: string | null;
  checks: string[];
}

const shadeSteps = (s: Shade) => (s === '+' ? 1 : s === '-' ? -1 : 0);

/** INDEX(Scale!B, n) with n 1-based; clamped so shading can never fall off the scale. */
function scaleAt(step1: number): number {
  const i = Math.min(Math.max(step1, 1), POINT_SCALE.length) - 1;
  return POINT_SCALE[i];
}

/** MATCH(value, Scale!B, 0): 1-based exact position on the scale. */
function stepOf(points: number): number {
  return POINT_SCALE.indexOf(points as (typeof POINT_SCALE)[number]) + 1;
}

/** Column O. */
export function knowHowPoints(i: EvaluationInputs): number | null {
  if (!i.khTechnical || !i.khBreadth || !i.khHumanRelations) return null;
  const step =
    LETTERS.indexOf(i.khTechnical) * 3 +
    BREADTHS.indexOf(i.khBreadth) +
    Number(i.khHumanRelations) -
    1 +
    shadeSteps(i.khShade) +
    13;
  return scaleAt(step);
}

/** Column P, returned as a percentage (e.g. 19 for 19%). */
export function problemSolvingPercent(i: EvaluationInputs): number | null {
  if (!i.psEnvironment || !i.psChallenge) return null;
  const step =
    Math.min(
      LETTERS.indexOf(i.psEnvironment) + 2 * (Number(i.psChallenge) - 1) + (i.psPick === 'High' ? 1 : 0),
      15,
    ) + 1;
  return scaleAt(step);
}

/** Column Q: KH × PS%, rounded down to the nearest value on the point scale. */
export function problemSolvingPoints(kh: number, psPercent: number): number {
  const raw = Math.round(((kh * psPercent) / 100) * 1e6) / 1e6;
  let best: number = POINT_SCALE[0];
  for (const p of POINT_SCALE) if (p <= raw) best = p;
  return best;
}

/** Column R. */
export function accountabilityPoints(i: EvaluationInputs): number | null {
  if (!i.acFreedom || !i.acMagnitude) return null;
  if (i.acMagnitude !== 'N' && !i.acImpact) return null;
  const f = LETTERS.indexOf(i.acFreedom);
  const step =
    i.acMagnitude === 'N'
      ? f * 3 + 3
      : f * 3 + 3 * (Number(i.acMagnitude) - 1) + IMPACTS.indexOf(i.acImpact as Impact) + 4;
  return scaleAt(step + shadeSteps(i.acShade));
}

/** Grades must be sorted by minPoints ascending. MATCH(S, mins, 1). */
export function gradeFor(total: number, grades: GradeBand[]): GradeBand | null {
  let hit: GradeBand | null = null;
  for (const g of grades) if (g.minPoints <= total) hit = g;
  return hit;
}

export function sortGrades(grades: GradeBand[]): GradeBand[] {
  return [...grades].sort((a, b) => a.minPoints - b.minPoints);
}

/** Full Evaluator row: columns O–W. */
export function evaluate(inputs: EvaluationInputs, gradesIn: GradeBand[]): EvaluationResult {
  const grades = sortGrades(gradesIn);
  const kh = knowHowPoints(inputs);
  const psPct = kh === null ? null : problemSolvingPercent(inputs);
  const ps = kh !== null && psPct !== null ? problemSolvingPoints(kh, psPct) : null;
  const ac = accountabilityPoints(inputs);

  const base: EvaluationResult = {
    complete: false,
    khPoints: kh,
    psPercent: psPct,
    psPoints: ps,
    acPoints: ac,
    totalPoints: null,
    profile: null,
    grade: null,
    careerLevel: null,
    checks: [],
  };
  if (kh === null || ps === null || ac === null) return base;

  const total = kh + ps + ac;
  const diff = stepOf(ac) - stepOf(ps);
  const profile = diff > 0 ? `A${diff}` : diff < 0 ? `P${-diff}` : 'L';
  const band = gradeFor(total, grades);

  const checks: string[] = [];
  if (Math.abs(diff) > 4) checks.push('Profile beyond A4/P4');
  const letterIdx = [inputs.khTechnical, inputs.psEnvironment, inputs.acFreedom].map((l) =>
    LETTERS.indexOf(l as Letter),
  );
  if (Math.max(...letterIdx) - Math.min(...letterIdx) > 1) checks.push('Letter stair gap >1');
  if (band) {
    const next = grades[grades.indexOf(band) + 1];
    const nextMin = next ? next.minPoints : Infinity;
    if (total < band.minPoints * 1.03 || total >= nextMin * 0.97) checks.push('Borderline grade');
  }

  return {
    ...base,
    complete: true,
    totalPoints: total,
    profile,
    grade: band ? band.grade : null,
    careerLevel: band ? band.careerLevel : null,
    checks,
  };
}

/** True when every required input is filled. */
export function inputsComplete(i: EvaluationInputs): boolean {
  return (
    knowHowPoints(i) !== null && problemSolvingPercent(i) !== null && accountabilityPoints(i) !== null
  );
}

/** Grades & Bands sheet defaults. */
export const DEFAULT_GRADES: GradeBand[] = [
  { grade: 1, minPoints: 0, careerLevel: 'Support', typicalRoles: 'Helper, cleaner' },
  { grade: 2, minPoints: 100, careerLevel: 'Support', typicalRoles: 'Messenger, office attendant' },
  { grade: 3, minPoints: 120, careerLevel: 'Support', typicalRoles: 'Driver, junior clerk' },
  { grade: 4, minPoints: 145, careerLevel: 'Operational', typicalRoles: 'Data entry, receptionist' },
  { grade: 5, minPoints: 175, careerLevel: 'Operational', typicalRoles: 'Clerk, machine operator' },
  { grade: 6, minPoints: 205, careerLevel: 'Operational', typicalRoles: 'Senior clerk, accounts assistant' },
  { grade: 7, minPoints: 250, careerLevel: 'Skilled / technical', typicalRoles: 'Technician, administrator' },
  { grade: 8, minPoints: 300, careerLevel: 'Skilled / technical', typicalRoles: 'Senior technician, team leader' },
  { grade: 9, minPoints: 360, careerLevel: 'Professional entry', typicalRoles: 'Graduate officer, supervisor' },
  { grade: 10, minPoints: 430, careerLevel: 'Professional', typicalRoles: 'Officer, engineer, accountant' },
  { grade: 11, minPoints: 515, careerLevel: 'Professional', typicalRoles: 'Senior officer, experienced specialist' },
  { grade: 12, minPoints: 620, careerLevel: 'Senior professional / first-line manager', typicalRoles: 'Assistant manager, lead specialist' },
  { grade: 13, minPoints: 745, careerLevel: 'Manager', typicalRoles: 'Manager of a unit or sub-function' },
  { grade: 14, minPoints: 890, careerLevel: 'Manager', typicalRoles: 'Senior manager, principal specialist' },
  { grade: 15, minPoints: 1070, careerLevel: 'Senior manager', typicalRoles: 'Head of department' },
  { grade: 16, minPoints: 1285, careerLevel: 'Senior manager', typicalRoles: 'Head of a major function' },
  { grade: 17, minPoints: 1540, careerLevel: 'Executive', typicalRoles: 'Director, business unit GM' },
  { grade: 18, minPoints: 1850, careerLevel: 'Executive', typicalRoles: 'Divisional director, CXO (mid-size)' },
  { grade: 19, minPoints: 2220, careerLevel: 'Senior executive', typicalRoles: 'CXO of a large firm' },
  { grade: 20, minPoints: 2660, careerLevel: 'Senior executive', typicalRoles: 'CEO of a mid-size firm' },
  { grade: 21, minPoints: 3195, careerLevel: 'Top executive', typicalRoles: 'CEO of a large firm' },
  { grade: 22, minPoints: 3835, careerLevel: 'Top executive', typicalRoles: 'Group CEO' },
  { grade: 23, minPoints: 4600, careerLevel: 'Top executive', typicalRoles: 'CEO of a multinational group' },
];

/**
 * Build `count` grades spanning [lowest, highest] with geometrically even band
 * widths. Grade 1 always starts at 0 so every score lands in a grade.
 */
export function generateGrades(count: number, lowest: number, highest: number): GradeBand[] {
  const n = Math.max(3, Math.min(60, Math.round(count)));
  const lo = Math.max(1, lowest);
  const hi = Math.max(lo + n, highest);
  const ratio = Math.pow(hi / lo, 1 / (n - 2));
  const out: GradeBand[] = [{ grade: 1, minPoints: 0, careerLevel: '', typicalRoles: '' }];
  for (let k = 0; k < n - 1; k++) {
    out.push({ grade: k + 2, minPoints: Math.round(lo * Math.pow(ratio, k)), careerLevel: '', typicalRoles: '' });
  }
  return out;
}

/** Level definitions used by the UI help text and the JD analyser prompt. */
export const LEVEL_DEFINITIONS = {
  khTechnical: {
    A: 'Basic: simple, repetitive tasks learned in a few days.',
    B: 'Elementary vocational: standard routines and simple equipment.',
    C: 'Vocational: procedural proficiency, specialised equipment or systems.',
    D: 'Advanced vocational: specialised skill from extended on-job or post-secondary training.',
    E: 'Basic professional: theory and principles of a professional or technical discipline (degree / qualification).',
    F: 'Seasoned professional: deep proficiency in a specialised field built through substantial experience.',
    G: 'Professional mastery: authoritative expertise across a field.',
    H: 'Unique mastery: recognised external authority in a field.',
  },
  khBreadth: {
    T: 'Task: performance of specific tasks, no management of others.',
    I: 'Activity: one activity or a homogeneous team.',
    II: 'Related: integration of related activities within a function.',
    III: 'Diverse: integration of diverse functions or a major operation.',
    IV: 'Broad: total integration of a business or major organisation.',
  },
  khHumanRelations: {
    '1': 'Basic: courtesy and effective exchange of information.',
    '2': 'Important: understanding and influencing people is important.',
    '3': 'Critical: developing, motivating and persuading others is critical.',
  },
  psEnvironment: {
    A: 'Strict routine: simple rules and detailed instructions.',
    B: 'Routine: established routines and standing instructions.',
    C: 'Semi-routine: somewhat diversified procedures and precedents.',
    D: 'Standardised: substantially diversified procedures and specialised standards.',
    E: 'Clearly defined: clearly defined policies and principles.',
    F: 'Broadly defined: broad policies and specific objectives.',
    G: 'Generally defined: general policies and ultimate goals.',
    H: 'Abstractly defined: business philosophy and general laws.',
  },
  psChallenge: {
    '1': 'Repetitive: identical situations, simple choices.',
    '2': 'Patterned: similar situations, discriminating choice between learned things.',
    '3': 'Interpolative: differing situations, search for solutions within known areas.',
    '4': 'Adaptive: variable situations, analytical and evaluative thinking.',
    '5': 'Uncharted: novel situations, development of new concepts.',
  },
  acFreedom: {
    A: 'Prescribed: direct and detailed instructions, close supervision.',
    B: 'Controlled: instructions and established work routines.',
    C: 'Standardised: standard practices and procedures, supervisory review of progress.',
    D: 'Generally regulated: practices and procedures covered by precedents or policy.',
    E: 'Directed: broad practices and procedures, functional policy and goals.',
    F: 'Oriented direction: functional policy and goals, general management direction.',
    G: 'Broad guidance: general policy, top management guidance.',
    H: 'Strategic guidance: governance only, board-level direction.',
  },
  acMagnitude: {
    N: 'None / indeterminate: no measurable financial magnitude.',
    '1': 'Very small: under USD 1M annual value.',
    '2': 'Small: USD 1–10M.',
    '3': 'Medium: USD 10–100M.',
    '4': 'Large: USD 100M–1B.',
    '5': 'Very large: over USD 1B.',
  },
  acImpact: {
    R: 'Remote: informational, recording or incidental services.',
    C: 'Contributory: advisory or facilitating services used by others.',
    S: 'Shared: joint control with others (other than own subordinates).',
    P: 'Prime: controlling impact; the job is answerable for end results.',
  },
} as const;
