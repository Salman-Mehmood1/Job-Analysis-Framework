/**
 * Job Evaluation Questionnaire Pack: the eight Hay elements as weighted
 * questionnaires answered by the job holder (JH), line manager (LM) and
 * evaluator (EV), and the pack's consolidation rules (Part 1.3 / 1.4).
 */
import {
  BREADTHS,
  type EvaluationInputs,
  EMPTY_INPUTS,
  IMPACTS,
  LETTERS,
  type Shade,
} from './engine';

export type ElementId = 'KH_T' | 'KH_B' | 'KH_H' | 'PS_E' | 'PS_C' | 'AC_F' | 'AC_I';
export type RespondentRole = 'JH' | 'LM';

export interface Question {
  id: string; // e.g. "KH_T.1"
  text: string;
  weight: number;
  /** Description of each level, lowest first (index 0 = value 1). */
  options: string[];
  /** Rated by the evaluator only (PS-C Q4). */
  evaluatorOnly?: boolean;
}

export interface ElementQuestionnaire {
  id: ElementId;
  code: string; // "KH-T"
  name: string;
  factor: 'Know-How' | 'Problem Solving' | 'Accountability';
  intro: string;
  /** Level codes, lowest first; value = index + 1. */
  codes: readonly string[];
  /** Spread flag threshold: A–H scales allow 2 levels, others 1. */
  spreadLimit: number;
  /** Whether the element's shade is used in scoring (KH-T, PS-C, AC-F). */
  shadeUsed: boolean;
  questions: Question[];
}

const NUMS3 = ['1', '2', '3'] as const;
const NUMS5 = ['1', '2', '3', '4', '5'] as const;

const q = (id: string, text: string, weight: number, options: string[], evaluatorOnly = false): Question => ({
  id,
  text,
  weight,
  options,
  ...(evaluatorOnly ? { evaluatorOnly } : {}),
});

export const QUESTIONNAIRE: ElementQuestionnaire[] = [
  {
    id: 'KH_T',
    code: 'KH-T',
    name: 'Practical / Technical Know-How',
    factor: 'Know-How',
    intro: 'The depth and breadth of specialised knowledge, skill and experience the job needs for fully competent performance. Rate the job’s requirement, not the current holder’s qualifications.',
    codes: LETTERS,
    spreadLimit: 2,
    shadeUsed: true,
    questions: [
      q('KH_T.1', 'What is the minimum education or qualification needed to perform this job?', 3, [
        'Basic literacy; no formal qualification needed',
        'Secondary school (Matric / O-level)',
        'Intermediate / A-level, or a short vocational certificate',
        'Diploma (e.g. DAE) or vocational qualification plus specialised training',
        'Bachelor’s degree or entry-level professional qualification',
        'Master’s degree or full professional qualification (e.g. CA, ACCA, PEC-registered engineer)',
        'Advanced professional or postgraduate qualification plus deep specialised expertise',
        'Highest-level mastery: doctorate-level expertise or equivalent senior leadership standing',
      ]),
      q('KH_T.2', 'How much relevant experience is needed to perform the job fully competently?', 3, [
        'Less than 1 month', '1–6 months', '6–12 months', '1–3 years', '3–5 years', '5–10 years', '10–15 years', 'More than 15 years, at senior level',
      ]),
      q('KH_T.3', 'Which best describes the knowledge applied in the job?', 2, [
        'Simple tasks learned by demonstration',
        'Standard routines and simple equipment',
        'Procedures and systems of one work area, or specialised equipment',
        'Specialised practical techniques applied across varied work',
        'Theories and principles of a professional discipline',
        'Broad, deep application of a discipline, or mastery of a specialisation',
        'Command of a complex field, or integration of several functions’ know-how',
        'Pre-eminent mastery of a field or of business leadership',
      ]),
      q('KH_T.4', 'How long would a suitably qualified new hire take to become fully effective?', 1, [
        'A few days', '1–4 weeks', '1–3 months', '3–6 months', '6–12 months', '1–2 years', '2–3 years', 'More than 3 years',
      ]),
      q('KH_T.5', 'Who relies on this job’s expertise?', 1, [
        'No one; the job follows others’ direction',
        'Immediate co-workers, on simple matters',
        'Team members, on procedures in own area',
        'Own and neighbouring teams, on practical or technical matters',
        'Colleagues within own function, on professional matters',
        'Own and other functions; recognised subject-matter expert',
        'The whole organisation; the internal authority on the field',
        'External bodies, industry or regulators recognise the authority',
      ]),
    ],
  },
  {
    id: 'KH_B',
    code: 'KH-B',
    name: 'Managerial Breadth (Planning, Organising, Integrating)',
    factor: 'Know-How',
    intro: 'How widely the job must plan, organise, coordinate and integrate activities, functions and resources. Applies to managers and to specialists who integrate across areas.',
    codes: BREADTHS,
    spreadLimit: 1,
    shadeUsed: false,
    questions: [
      q('KH_B.1', 'What does the job plan, organise and integrate?', 3, [
        'Own tasks only, or tasks of a small group',
        'One activity with a single objective',
        'Several related activities within one function',
        'Diverse functions within a business unit, or one major function company-wide',
        'All major functions of the organisation or of a large division',
      ]),
      q('KH_B.2', 'How many distinct functions or sub-functions does the job manage or coordinate?', 2, [
        'None', 'One activity or sub-function', '2–3 related sub-functions', '4 or more, or functions of different disciplines', 'The full set of business functions',
      ]),
      q('KH_B.3', 'What is the job’s typical planning horizon?', 2, ['Day to week', 'Up to 3 months', '3–12 months', '1–3 years', 'More than 3 years (strategic)']),
      q('KH_B.4', 'Which resources does the job allocate and balance?', 2, [
        'Own time and tools',
        'A team’s work schedule and tasks',
        'Staff and budget within one function',
        'Budgets and resources across several functions',
        'Enterprise-wide capital, people and resources',
      ]),
      q('KH_B.5', 'Where does the job sit in the organisation?', 1, [
        'Individual contributor or team member',
        'Team leader, supervisor or individual specialist',
        'Section or functional manager, or senior specialist advising across functions',
        'Head of department, function or business unit',
        'CEO or member of the top executive team',
      ]),
    ],
  },
  {
    id: 'KH_H',
    code: 'KH-H',
    name: 'Human Relations Skills',
    factor: 'Know-How',
    intro: 'The interpersonal skill needed to achieve results through and with other people, inside and outside the organisation.',
    codes: NUMS3,
    spreadLimit: 1,
    shadeUsed: false,
    questions: [
      q('KH_H.1', 'What is the purpose of the job’s most demanding contacts?', 3, [
        'Exchanging information and courteous service',
        'Explaining, advising, persuading or influencing others’ actions',
        'Motivating, developing, negotiating major outcomes or changing behaviour',
      ]),
      q('KH_H.2', 'What responsibility does the job have for other people?', 2, [
        'None',
        'Supervises or guides a team, or trains others',
        'Leads managers or large teams; accountable for developing and motivating them',
      ]),
      q('KH_H.3', 'What are the job’s external contacts?', 2, [
        'None, or routine information exchange',
        'Clients, suppliers or authorities, where understanding and persuasion matter',
        'Senior negotiation with major stakeholders, regulators, partners or unions',
      ]),
      q('KH_H.4', 'What happens if interpersonal situations are handled poorly?', 2, [
        'Minor inconvenience',
        'Lost cooperation, complaints or delays',
        'Serious damage to relationships, deals, morale or reputation',
      ]),
      q('KH_H.5', 'How much conflict and change does the job handle?', 1, [
        'Rarely deals with conflict or change',
        'Resolves day-to-day disagreements',
        'Leads change and resolves significant conflicts',
      ]),
    ],
  },
  {
    id: 'PS_E',
    code: 'PS-E',
    name: 'Thinking Environment (Freedom to Think)',
    factor: 'Problem Solving',
    intro: 'How far the job’s thinking is guided or constrained by instructions, procedures, precedents and policies.',
    codes: LETTERS,
    spreadLimit: 2,
    shadeUsed: false,
    questions: [
      q('PS_E.1', 'What guides the job’s thinking?', 3, [
        'Detailed instructions and simple rules',
        'Standing instructions and established routines',
        'Well-defined procedures, with some choice between them',
        'Varied procedures and specialised precedents',
        'Clear policies, principles and specific objectives',
        'Broad functional policies and objectives',
        'General organisational policies and goals',
        'Business philosophy, law and broad societal considerations',
      ]),
      q('PS_E.2', 'When the job meets an unfamiliar problem, where does help come from?', 2, [
        'Supervisor present and consulted constantly',
        'Supervisor readily available and consulted often',
        'Supervisor available; procedures cover most cases',
        'Manager available; precedents cover most cases',
        'Manager consulted on exceptions only',
        'Senior management consulted on major issues only',
        'Top management consulted on strategic issues only',
        'Board or owners only',
      ]),
      q('PS_E.3', 'Who decides what the job does and how?', 2, [
        'Others set what and how, in detail',
        'Others set what and how; the job chooses the order',
        'Others set what; the job selects from defined methods',
        'Others set what; the job adapts methods',
        'The job decides how, within specific objectives',
        'The job shapes objectives within functional goals',
        'The job sets functional or unit objectives within organisational goals',
        'The job sets organisational direction',
      ]),
      q('PS_E.4', 'What is the job’s role in policy?', 2, [
        'Follows rules',
        'Follows routines',
        'Applies procedures',
        'Interprets procedures and precedents',
        'Interprets policies',
        'Develops procedures and contributes to functional policy',
        'Develops functional or organisational policy',
        'Shapes corporate philosophy and long-term direction',
      ]),
      q('PS_E.5', 'How often does the job depart from established methods?', 1, [
        'Never', 'Rarely', 'Occasionally, in minor ways', 'Regularly, within precedents', 'Regularly, within policy', 'Frequently, within broad objectives', 'Largely self-directed', 'Entirely self-directed',
      ]),
    ],
  },
  {
    id: 'PS_C',
    code: 'PS-C',
    name: 'Thinking Challenge (Complexity)',
    factor: 'Problem Solving',
    intro: 'The complexity of the problems the job faces and the originality of thought needed to solve them.',
    codes: NUMS5,
    spreadLimit: 1,
    shadeUsed: true,
    questions: [
      q('PS_C.1', 'Which best describes the problems the job typically faces?', 3, [
        'Identical situations', 'Similar situations', 'Differing situations', 'Situations needing analysis, interpretation and evaluation', 'Novel, non-recurring situations',
      ]),
      q('PS_C.2', 'How are solutions usually found?', 2, [
        'Choose from what has been learned',
        'Choose among known solutions',
        'Search within known knowledge and techniques',
        'Analyse, evaluate and develop new answers',
        'Create new concepts or approaches with no precedent',
      ]),
      q('PS_C.3', 'How much original thinking is needed?', 2, [
        'None', 'Minimal judgement', 'Judgement to select or adapt approaches', 'Analytical and constructive thinking', 'Innovative, conceptual thinking',
      ]),
      q('PS_C.4', 'Evaluator rating of the “most complex problem” example given by the job holder and line manager.', 2, [
        'Repetitive', 'Patterned', 'Variable', 'Adaptive', 'Uncharted',
      ], true),
      q('PS_C.5', 'What share of working time goes on non-routine problems?', 1, [
        'Under 10%', '10–25%', '25–50%', '50–75%', 'Over 75%, largely novel issues',
      ]),
    ],
  },
  {
    id: 'AC_F',
    code: 'AC-F',
    name: 'Freedom to Act',
    factor: 'Accountability',
    intro: 'The degree of personal or procedural control over the job’s actions and decisions.',
    codes: LETTERS,
    spreadLimit: 2,
    shadeUsed: true,
    questions: [
      q('AC_F.1', 'What supervision does the job receive?', 3, [
        'Direct, detailed instructions and close supervision',
        'Close supervision; work checked often',
        'Supervision of progress and results',
        'General supervision; periodic review',
        'Managerial direction on objectives',
        'General direction from senior management',
        'Broad guidance from top management',
        'Only board, owners or regulators',
      ]),
      q('AC_F.2', 'How long can the job work before its results are reviewed?', 2, [
        'Less than 1 day', '1 day – 1 week', '1 week – 1 month', '1–3 months', '3–6 months', '6–12 months', '1–2 years', 'More than 2 years',
      ]),
      q('AC_F.3', 'Which decisions does the job take without referral?', 2, [
        'None',
        'Order of routine tasks',
        'Methods within procedures',
        'Priorities and practices for own area',
        'Operational decisions within functional practice',
        'Functional decisions within policy',
        'Business-unit decisions within organisational policy',
        'Strategic decisions for the organisation',
      ]),
      q('AC_F.4', 'What approval authority does the job hold (spend, hiring, contracts)?', 2, [
        'None',
        'None; may initiate requests',
        'Minor purchases within a set budget',
        'Routine spend within own area’s budget',
        'Spend and hiring within a section budget',
        'Functional budget, hiring and contracts',
        'Business-unit budget and major contracts',
        'Full authority, subject only to the board',
      ]),
      q('AC_F.5', 'Who reviews the job’s work?', 1, [
        'Team leader checks each output',
        'Supervisor checks regularly',
        'Supervisor reviews completed work',
        'Manager reviews outcomes',
        'Senior manager reviews results',
        'Director or head of function',
        'CEO or executive committee',
        'Board',
      ]),
    ],
  },
  {
    id: 'AC_I',
    code: 'AC-I',
    name: 'Impact on End Results',
    factor: 'Accountability',
    intro: 'How directly the job affects the result recorded under Magnitude. Answer every question about that same result.',
    codes: IMPACTS,
    spreadLimit: 1,
    shadeUsed: false,
    questions: [
      q('AC_I.1', 'What is the job’s role in achieving the primary result?', 3, [
        'Provides information, records or incidental services used by others',
        'Advises, interprets or facilitates; others decide',
        'Jointly responsible with peers or other functions',
        'Controls the result; its actions are decisive',
      ]),
      q('AC_I.2', 'If the result is missed, who is held accountable?', 2, [
        'Not linked to the job', 'The job explains the advice it gave', 'The job and its peers share accountability', 'Primarily the job holder',
      ]),
      q('AC_I.3', 'What is the job’s main output?', 2, [
        'Data, records or reports',
        'Recommendations, analysis or specialist advice',
        'Joint plans or decisions made with peers',
        'Decisions and actions that directly deliver the result',
      ]),
      q('AC_I.4', 'Can the job change the result directly?', 2, [
        'No', 'Indirectly, through others’ decisions', 'Partly; needs peers’ agreement', 'Fully, within delegated authority',
      ]),
      q('AC_I.5', 'How does the result appear in the job’s performance measures?', 1, [
        'Not measured', 'As support or advisory measures', 'As joint measures shared with another function', 'As the job’s own core measures',
      ]),
    ],
  },
];

export const ALL_QUESTIONS = QUESTIONNAIRE.flatMap((e) => e.questions.map((x) => ({ ...x, element: e })));
export const QUESTION_BY_ID = new Map(ALL_QUESTIONS.map((x) => [x.id, x]));
/** Questions the job holder and line manager answer (everything except evaluator-only ratings). */
export const RESPONDENT_QUESTIONS = ALL_QUESTIONS.filter((x) => !x.evaluatorOnly);

/** Part 2: job information, completed by the job holder and checked by the line manager. */
export const JOB_INFO_FIELDS = [
  { key: 'purpose', label: 'Job purpose', hint: 'One sentence: why the job exists.' },
  { key: 'accountabilities', label: 'Key accountabilities', hint: '6–8 end results, each: action + object + outcome.', rows: 5 },
  { key: 'duties', label: 'Main duties in a typical week / month', rows: 4 },
  { key: 'directReports', label: 'Direct reports', hint: 'Number and job titles.' },
  { key: 'totalStaff', label: 'Total staff in area', hint: 'Direct + indirect.' },
  { key: 'internalContacts', label: 'Main internal contacts and purpose', rows: 3 },
  { key: 'externalContacts', label: 'Main external contacts and purpose', rows: 3 },
  { key: 'systems', label: 'Key systems, tools, equipment', rows: 2 },
] as const;
export type JobInfo = Partial<Record<(typeof JOB_INFO_FIELDS)[number]['key'], string>>;

/** Answers: question id → level value (1-based). */
export type Answers = Record<string, number>;

export const MAGNITUDE_MEASURES = [
  'Revenue / sales',
  'Operating budget or cost base',
  'Payroll of area managed',
  'Value of assets managed',
  'Capital or project spend',
  'Other',
] as const;

export interface MagnitudeFigure {
  measure: string;
  /** Annual value in USD. */
  usd: number | null;
  /** Annual value in local currency (for the record). */
  local: string;
  influence: 'direct' | 'shared' | 'advisory' | '';
}

/** Part 5.2 Magnitude worksheet, completed by the evaluator from facts. */
export interface MagnitudeWorksheet {
  figures: MagnitudeFigure[];
  /** Index into figures of the primary measure, or null. */
  primary: number | null;
  level: 'N' | '1' | '2' | '3' | '4' | '5' | '';
  source: string;
}

export interface ElementOverride {
  level: number;
  shade: Shade;
  rationale: string;
}

/** Evaluator's side of the questionnaire, stored on the evaluation. */
export interface EvaluatorQuestionnaire {
  answers: Answers;
  magnitude: MagnitudeWorksheet;
  overrides: Partial<Record<ElementId, ElementOverride>>;
}

export const EMPTY_EV_QUESTIONNAIRE: EvaluatorQuestionnaire = {
  answers: {},
  magnitude: { figures: MAGNITUDE_MEASURES.map((m) => ({ measure: m, usd: null, local: '', influence: '' })), primary: null, level: '', source: '' },
  overrides: {},
};

/** Step 3: USD annual value → magnitude level. */
export function magnitudeFromUsd(usd: number | null | undefined): MagnitudeWorksheet['level'] {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return 'N';
  if (usd < 1e6) return '1';
  if (usd < 1e7) return '2';
  if (usd < 1e8) return '3';
  if (usd < 1e9) return '4';
  return '5';
}

/** Median of numbers; for an even count, the mean of the middle two. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface QuestionResult {
  id: string;
  jh: number | null;
  lm: number | null;
  ev: number | null;
  /** Number of job-holder responses behind `jh` (several holders → median). */
  jhCount: number;
  consolidated: number | null;
  /** JH and LM two or more levels apart. */
  divergent: boolean;
}

export interface ElementResult {
  id: ElementId;
  questions: QuestionResult[];
  complete: boolean;
  weightedAverage: number | null;
  /** Level value from the weighted average (x.5 rounds up). */
  computedLevel: number | null;
  deviation: number | null;
  computedShade: Shade;
  /** After any evaluator override. */
  finalLevel: number | null;
  finalShade: Shade;
  finalCode: string | null;
  overridden: boolean;
  spreadFlag: boolean;
  divergentQuestions: string[];
  overrideError: string | null;
}

export interface QuestionnaireResult {
  elements: Record<ElementId, ElementResult>;
  magnitude: MagnitudeWorksheet['level'];
  inputs: EvaluationInputs;
  complete: boolean;
  /** Questions the evaluator has not answered yet. */
  missing: string[];
}

/**
 * Consolidates JH, LM and EV answers (Part 1.3).
 * - Question level: median of JH, LM and EV when all three exist; otherwise the EV value.
 *   Several job holders (or line managers) are first reduced to their median.
 *   Evaluator-only questions use the EV rating.
 * - Element: WA = Σ(weight × level) ÷ 10, rounded (x.5 up) to the final level;
 *   deviation ≥ +0.25 gives "+", ≤ −0.25 gives "−".
 * - Override: the panel may move the final level by at most one, with a rationale.
 */
export function consolidate(
  ev: EvaluatorQuestionnaire,
  jhResponses: Answers[],
  lmResponses: Answers[],
): QuestionnaireResult {
  const elements = {} as Record<ElementId, ElementResult>;
  const missing: string[] = [];

  for (const el of QUESTIONNAIRE) {
    const questions: QuestionResult[] = el.questions.map((qu) => {
      const jhVals = jhResponses.map((a) => a[qu.id]).filter((v): v is number => typeof v === 'number');
      const lmVals = lmResponses.map((a) => a[qu.id]).filter((v): v is number => typeof v === 'number');
      const jhMed = qu.evaluatorOnly ? null : median(jhVals);
      const lmMed = qu.evaluatorOnly ? null : median(lmVals);
      const jh = jhMed === null ? null : Math.round(jhMed);
      const lm = lmMed === null ? null : Math.round(lmMed);
      const evv = typeof ev.answers[qu.id] === 'number' ? ev.answers[qu.id] : null;
      if (evv === null) missing.push(qu.id);
      const consolidated = evv === null ? null : jh !== null && lm !== null ? median([jh, lm, evv]) : evv;
      return { id: qu.id, jh, lm, ev: evv, jhCount: jhVals.length, consolidated, divergent: jh !== null && lm !== null && Math.abs(jh - lm) >= 2 };
    });

    const complete = questions.every((x) => x.consolidated !== null);
    const max = el.codes.length;
    let wa: number | null = null;
    let level: number | null = null;
    let deviation: number | null = null;
    let shade: Shade = '';
    if (complete) {
      const total = el.questions.reduce((s, qu, i) => s + qu.weight * questions[i].consolidated!, 0);
      wa = Math.round((total / 10) * 1000) / 1000;
      level = Math.min(max, Math.max(1, Math.floor(wa + 0.5)));
      deviation = Math.round((wa - level) * 1000) / 1000;
      shade = deviation >= 0.25 ? '+' : deviation <= -0.25 ? '-' : '';
    }
    const levels = questions.map((x) => x.consolidated).filter((v): v is number => v !== null);
    const spreadFlag = levels.length > 1 && Math.max(...levels) - Math.min(...levels) > el.spreadLimit;

    const ov = ev.overrides[el.id];
    let overrideError: string | null = null;
    let finalLevel = level;
    let finalShade = shade;
    let overridden = false;
    if (ov && level !== null) {
      if (Math.abs(ov.level - level) > 1 || ov.level < 1 || ov.level > max) overrideError = 'An override can move the level by one step at most';
      else if (!ov.rationale?.trim()) overrideError = 'Give a rationale for the override';
      else {
        finalLevel = ov.level;
        finalShade = ov.shade ?? '';
        overridden = ov.level !== level || (ov.shade ?? '') !== shade;
      }
    }
    elements[el.id] = {
      id: el.id,
      questions,
      complete,
      weightedAverage: wa,
      computedLevel: level,
      deviation,
      computedShade: shade,
      finalLevel,
      finalShade,
      finalCode: finalLevel === null ? null : el.codes[finalLevel - 1],
      overridden,
      spreadFlag,
      divergentQuestions: questions.filter((x) => x.divergent).map((x) => x.id),
      overrideError,
    };
  }

  const magnitude = ev.magnitude?.level ?? '';
  const e = elements;
  const code = (id: ElementId) => (e[id].overrideError ? null : e[id].finalCode);
  const inputs: EvaluationInputs = {
    ...EMPTY_INPUTS,
    khTechnical: (code('KH_T') ?? '') as EvaluationInputs['khTechnical'],
    khBreadth: (code('KH_B') ?? '') as EvaluationInputs['khBreadth'],
    khHumanRelations: (code('KH_H') ?? '') as EvaluationInputs['khHumanRelations'],
    khShade: code('KH_T') ? e.KH_T.finalShade : '',
    psEnvironment: (code('PS_E') ?? '') as EvaluationInputs['psEnvironment'],
    psChallenge: (code('PS_C') ?? '') as EvaluationInputs['psChallenge'],
    // PS-C shade "+" selects the higher of the two Problem Solving percentages.
    psPick: code('PS_C') && e.PS_C.finalShade === '+' ? 'High' : 'Low',
    acFreedom: (code('AC_F') ?? '') as EvaluationInputs['acFreedom'],
    acShade: code('AC_F') ? e.AC_F.finalShade : '',
    acMagnitude: magnitude,
    acImpact: magnitude === 'N' ? '' : ((code('AC_I') ?? '') as EvaluationInputs['acImpact']),
  };
  const complete =
    QUESTIONNAIRE.every((el) => elements[el.id].complete && !elements[el.id].overrideError) && magnitude !== '';
  return { elements, magnitude, inputs, complete, missing };
}

/** Clamp untrusted answers to valid level values for known questions. */
export function cleanAnswers(raw: Record<string, unknown>, opts: { respondent?: boolean } = {}): Answers {
  const out: Answers = {};
  for (const [id, v] of Object.entries(raw ?? {})) {
    const qu = QUESTION_BY_ID.get(id);
    if (!qu || (opts.respondent && qu.evaluatorOnly)) continue;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= qu.options.length) out[id] = n;
  }
  return out;
}
