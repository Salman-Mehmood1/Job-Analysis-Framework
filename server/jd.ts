/**
 * Job-description analyser: proposes the eight Hay element levels for a job
 * from its description.
 *
 * Uses Claude when API credentials are configured; otherwise falls back to a
 * transparent rule-based estimator so the feature works offline.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  BREADTHS,
  CHALLENGES,
  EMPTY_INPUTS,
  type EvaluationInputs,
  HUMAN_RELATIONS,
  IMPACTS,
  LETTERS,
  LEVEL_DEFINITIONS,
  MAGNITUDES,
} from '../shared/engine';

export const MODEL = process.env.JD_MODEL ?? 'claude-opus-5-5';

export interface ElementRationale {
  level: string;
  reason: string;
}

export interface JdAnalysis {
  method: 'ai' | 'rules';
  model?: string;
  inputs: EvaluationInputs;
  rationale: Record<string, ElementRationale>;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  suggested: { title: string; department: string; jobFamily: string };
  warnings: string[];
}

export function aiEnabled(): boolean {
  if (process.env.JD_ANALYZER === 'rules') return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------------------------------------------------------------- Claude ---

const element = (vals: readonly string[]) =>
  z.object({ level: z.enum(vals as [string, ...string[]]), reason: z.string() });

const aiSchema = z.object({
  khTechnical: element(LETTERS),
  khBreadth: element(BREADTHS),
  khHumanRelations: element(HUMAN_RELATIONS),
  psEnvironment: element(LETTERS),
  psChallenge: element(CHALLENGES),
  psPick: z.enum(['Low', 'High']),
  acFreedom: element(LETTERS),
  acMagnitude: element(MAGNITUDES),
  acImpact: element(IMPACTS),
  summary: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  suggestedTitle: z.string(),
  suggestedDepartment: z.string(),
  suggestedJobFamily: z.string(),
  warnings: z.array(z.string()),
});

const elemJson = (vals: readonly string[]) => ({
  type: 'object',
  properties: { level: { type: 'string', enum: [...vals] }, reason: { type: 'string' } },
  required: ['level', 'reason'],
  additionalProperties: false,
});

const AI_JSON_SCHEMA = {
  type: 'object',
  properties: {
    khTechnical: elemJson(LETTERS),
    khBreadth: elemJson(BREADTHS),
    khHumanRelations: elemJson(HUMAN_RELATIONS),
    psEnvironment: elemJson(LETTERS),
    psChallenge: elemJson(CHALLENGES),
    psPick: { type: 'string', enum: ['Low', 'High'] },
    acFreedom: elemJson(LETTERS),
    acMagnitude: elemJson(MAGNITUDES),
    acImpact: elemJson(IMPACTS),
    summary: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    suggestedTitle: { type: 'string' },
    suggestedDepartment: { type: 'string' },
    suggestedJobFamily: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'khTechnical', 'khBreadth', 'khHumanRelations', 'psEnvironment', 'psChallenge', 'psPick',
    'acFreedom', 'acMagnitude', 'acImpact', 'summary', 'confidence', 'suggestedTitle',
    'suggestedDepartment', 'suggestedJobFamily', 'warnings',
  ],
  additionalProperties: false,
};

function definitionsText(): string {
  const names: Record<string, string> = {
    khTechnical: 'Know-How: Technical / specialised (A–H)',
    khBreadth: 'Know-How: Managerial breadth (T, I, II, III, IV)',
    khHumanRelations: 'Know-How: Human relations (1–3)',
    psEnvironment: 'Problem Solving: Thinking environment (A–H)',
    psChallenge: 'Problem Solving: Thinking challenge (1–5)',
    acFreedom: 'Accountability: Freedom to act (A–H)',
    acMagnitude: 'Accountability: Magnitude, annual USD value the job affects (N, 1–5)',
    acImpact: 'Accountability: Impact on that magnitude (R, C, S, P)',
  };
  return Object.entries(LEVEL_DEFINITIONS)
    .map(([k, levels]) => `${names[k]}\n${Object.entries(levels).map(([l, d]) => `  ${l} — ${d}`).join('\n')}`)
    .join('\n\n');
}

const SYSTEM_PROMPT = `You are an experienced job evaluation analyst using the Hay point-factor method (Know-How, Problem Solving, Accountability).
You read a job description and choose a level for each of the eight elements below. Evaluate the job as described, not the person holding it.

${definitionsText()}

Guidance:
- Keep the "letter stair" consistent: the Know-How technical letter, Problem Solving environment letter and Accountability freedom letter are usually within one letter of each other. Explain any larger gap.
- psPick chooses between the two Problem Solving percentages allowed for the chosen thinking environment and challenge: "Low" is the lower percentage (the usual choice), "High" the higher one, only for jobs at the top end of that combination.
- Magnitude: estimate the annual value (budget, revenue, cost base, assets) the job most directly affects. Use N when no measurable figure applies. If the description uses another currency, convert to USD approximately and say so in the reason.
- Impact: Prime only if the job is answerable for the end result; Contributory for advisory or support roles.
- Each reason should cite evidence from the description in one or two sentences.
- confidence reflects how much evidence the description gives. Add a warning for anything missing or ambiguous (e.g. no budget figure, unclear reporting line).
- suggestedTitle / suggestedDepartment / suggestedJobFamily: short values inferred from the description (empty string if unknown).`;

async function analyseWithClaude(title: string, text: string): Promise<JdAnalysis> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: AI_JSON_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Job title: ${title || '(not given)'}\n\n<job_description>\n${text}\n</job_description>`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The AI declined to analyse this description. Try the rule-based analyser instead.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The AI response was cut off. Try a shorter job description.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('The AI returned no analysis.');
  const parsed = aiSchema.parse(JSON.parse(textBlock.text));

  const inputs: EvaluationInputs = {
    ...EMPTY_INPUTS,
    khTechnical: parsed.khTechnical.level as EvaluationInputs['khTechnical'],
    khBreadth: parsed.khBreadth.level as EvaluationInputs['khBreadth'],
    khHumanRelations: parsed.khHumanRelations.level as EvaluationInputs['khHumanRelations'],
    psEnvironment: parsed.psEnvironment.level as EvaluationInputs['psEnvironment'],
    psChallenge: parsed.psChallenge.level as EvaluationInputs['psChallenge'],
    psPick: parsed.psPick,
    acFreedom: parsed.acFreedom.level as EvaluationInputs['acFreedom'],
    acMagnitude: parsed.acMagnitude.level as EvaluationInputs['acMagnitude'],
    acImpact: (parsed.acMagnitude.level === 'N' ? '' : parsed.acImpact.level) as EvaluationInputs['acImpact'],
  };
  const keys = ['khTechnical', 'khBreadth', 'khHumanRelations', 'psEnvironment', 'psChallenge', 'acFreedom', 'acMagnitude', 'acImpact'] as const;
  return {
    method: 'ai',
    model: response.model,
    inputs,
    rationale: Object.fromEntries(keys.map((k) => [k, parsed[k]])),
    summary: parsed.summary,
    confidence: parsed.confidence,
    suggested: {
      title: parsed.suggestedTitle,
      department: parsed.suggestedDepartment,
      jobFamily: parsed.suggestedJobFamily,
    },
    warnings: parsed.warnings,
  };
}

// ----------------------------------------------------------- Rule-based ---

const has = (text: string, ...patterns: RegExp[]) => patterns.some((p) => p.test(text));
const L = (i: number) => LETTERS[Math.max(0, Math.min(7, i))];

/** Largest money figure in the text, in USD millions (best effort). */
function largestMoneyMillions(text: string): number | null {
  const re = /(?:usd|us\$|\$|pkr|rs\.?|eur|€|gbp|£|aed|sar)?\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|b|million|mn|m|k|thousand)?\b/gi;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const full = m[0].toLowerCase();
    const unit = (m[2] ?? '').toLowerCase();
    const hasCurrency = /usd|us\$|\$|pkr|rs|eur|€|gbp|£|aed|sar/.test(full);
    if (!hasCurrency && !unit) continue; // plain numbers (years, headcount) are not money
    if (!hasCurrency && (unit === 'm' || unit === 'b' || unit === 'k')) continue;
    let v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    if (unit.startsWith('b')) v *= 1000;
    else if (unit.startsWith('m')) v *= 1;
    else if (unit === 'k' || unit === 'thousand') v /= 1000;
    else v /= 1e6;
    if (/pkr|rs/.test(full)) v /= 280; // rough PKR→USD
    if (/aed/.test(full)) v /= 3.67;
    if (/sar/.test(full)) v /= 3.75;
    if (best === null || v > best) best = v;
  }
  return best;
}

function yearsOfExperience(text: string): number | null {
  const m = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?/gi)].map((x) => Number(x[1]));
  return m.length ? Math.max(...m) : null;
}

function teamSize(text: string): number | null {
  const m = [...text.matchAll(/(?:team of|manag\w* (?:a team of )?|leads? (?:a team of )?|supervis\w* )\s*(\d{1,5})/gi)].map((x) => Number(x[1]));
  return m.length ? Math.max(...m) : null;
}

export function analyseWithRules(title: string, rawText: string): JdAnalysis {
  const text = `${title}\n${rawText}`.toLowerCase();
  const t = title.toLowerCase();
  const warnings: string[] = ['Rule-based estimate: review every level before relying on it.'];

  // Seniority tier from the title, the strongest single signal.
  let tier = 3;
  let tierWhy = 'no clear seniority signal; assumed mid-level';
  const tiers: [RegExp, number, string][] = [
    [/\b(group ceo|chief executive|managing director|\bceo\b|president)\b/, 9, 'top executive title'],
    [/\b(chief|cfo|coo|cto|cio|chro|cmo|vp|vice president|general manager|director)\b/, 8, 'executive / director title'],
    [/\b(head of|head,|senior manager|plant manager|regional manager)\b/, 7, 'head-of-function / senior manager title'],
    [/\bmanager\b/, 6, 'manager title'],
    [/\b(assistant manager|lead|principal|team leader|supervisor)\b/, 5, 'lead / supervisory title'],
    [/\b(senior|sr\.?)\b.*\b(engineer|analyst|accountant|officer|specialist|consultant|developer)\b/, 5, 'senior professional title'],
    [/\b(engineer|analyst|accountant|officer|specialist|consultant|developer|executive)\b/, 4, 'professional title'],
    [/\b(technician|administrator|coordinator|senior clerk)\b/, 3, 'technical / administrative title'],
    [/\b(assistant|clerk|operator|receptionist|data entry)\b/, 2, 'operational / clerical title'],
    [/\b(driver|messenger|attendant|helper|cleaner|guard|peon)\b/, 1, 'support title'],
  ];
  for (const [re, v, why] of tiers) {
    if (re.test(t)) {
      tier = v;
      tierWhy = why;
      break;
    }
  }
  if (tier === 3 && !title) {
    for (const [re, v, why] of tiers) if (re.test(text)) { tier = v; tierWhy = `${why} (from description)`; break; }
  }

  // Know-How: technical
  // Seniority tier 1..9 → technical letter index (B..G).
  let tech = [1, 1, 2, 3, 4, 4, 5, 5, 6, 6][tier] ?? 3;
  const reasonsTech: string[] = [tierWhy];
  if (has(text, /\b(phd|doctorate)\b/)) { tech = Math.max(tech, 5); reasonsTech.push('doctorate'); }
  else if (has(text, /\b(master'?s|mba|chartered|\bca\b|acca|cpa|cima|professional (qualification|certification)|licensed|registered engineer)\b/)) { tech = Math.max(tech, 4); reasonsTech.push('professional qualification'); }
  else if (has(text, /\b(bachelor'?s|degree|graduate|bsc|bba|b\.?e\.?|beng)\b/)) { tech = Math.max(tech, 4); reasonsTech.push('degree required'); }
  else if (has(text, /\b(diploma|vocational|trade certificate|apprenticeship)\b/)) { tech = Math.max(tech, 2); reasonsTech.push('vocational qualification'); }
  const yrs = yearsOfExperience(text);
  if (yrs !== null) {
    if (yrs >= 15) tech = Math.max(tech, 6);
    else if (yrs >= 8) tech = Math.max(tech, 5);
    reasonsTech.push(`${yrs}+ years experience`);
  }

  // Know-How: breadth
  const leadsPeople = /\b(manager|head|director|chief|lead|supervisor|team leader|president|ceo|vp)\b/.test(t);
  let breadth = tier >= 9 ? 4 : tier >= 8 ? 3 : tier >= 7 ? 2 : tier >= 5 && leadsPeople ? 1 : 0;
  const reasonsBreadth = [breadth === 0 ? 'individual contributor scope' : 'management scope implied by title'];
  if (has(text, /\b(multiple (functions|departments|business units)|cross-functional|integrat\w+ .*functions|entire (organisation|organization|business|company))\b/)) {
    breadth = Math.max(breadth, 3); reasonsBreadth.push('integrates diverse functions');
  } else if (has(text, /\b(oversee|oversees|overseeing)\b.*\b(teams|sections|units)\b|\bseveral teams\b/)) {
    breadth = Math.max(breadth, 2); reasonsBreadth.push('oversees several related teams');
  }
  const team = teamSize(text);
  if (team !== null) {
    if (team >= 100) breadth = Math.max(breadth, 3);
    else if (team >= 15) breadth = Math.max(breadth, 2);
    else breadth = Math.max(breadth, 1);
    reasonsBreadth.push(`manages ~${team} people`);
  }

  // Know-How: human relations
  let hr = 1;
  const reasonsHr = ['information exchange'];
  if (has(text, /\b(negotiat|persua|motivat|coach|develop (staff|people|team)|lead (a |the )?team|influenc\w+ senior|stakeholder management|change management)\w*/)) {
    hr = 3; reasonsHr.splice(0, 1, 'leading, persuading or developing people is central');
  } else if (has(text, /\b(customer|client|stakeholder|liais|advise|train|present|supervis|influenc)\w*/)) {
    hr = 2; reasonsHr.splice(0, 1, 'regular influencing / advisory contact');
  }
  if (breadth >= 2) hr = Math.max(hr, 2);

  // Problem Solving
  let env = Math.max(0, Math.min(7, tech + (breadth >= 3 ? 1 : 0)));
  const reasonsEnv = ['kept in step with Know-How letter'];
  if (has(text, /\b(strategy|strategic|vision|policy (development|formulation)|long-term direction)\b/)) { env = Math.max(env, 5); reasonsEnv.push('sets strategy / policy'); }
  if (has(text, /\b(follow (established )?procedures|standard operating|checklist|as instructed|routine)\b/)) { env = Math.min(env, 2); reasonsEnv.push('works to established procedures'); }

  let ch = tier <= 1 ? 1 : tier <= 3 ? 2 : tier <= 6 ? 3 : 4;
  const reasonsCh: string[] = [];
  if (has(text, /\b(innovat|design new|develop new|pioneer|transform|research)\w*/)) { ch = Math.max(ch, 4); reasonsCh.push('develops new solutions'); }
  else if (has(text, /\b(analy[sz]|evaluat|diagnos|investigat|optimi[sz]|forecast|model)\w*/)) { ch = Math.max(ch, 3); reasonsCh.push('analytical work'); }
  else if (has(text, /\b(repetitive|data entry|filing|sorting)\b/)) { ch = Math.min(ch, 1); reasonsCh.push('repetitive tasks'); }
  if (tier >= 9) { ch = 5; reasonsCh.push('enterprise-level uncharted problems'); }
  if (!reasonsCh.length) reasonsCh.push('typical for the seniority level');

  // Accountability
  let freedom = Math.max(0, Math.min(7, tech + (tier >= 8 ? 1 : 0)));
  const reasonsFr = ['kept in step with Know-How letter'];
  if (has(text, /\b(reports? to (the )?(board|ceo|chief executive))\b/)) { freedom = Math.max(freedom, 6); reasonsFr.push('reports to the board / CEO'); }
  if (has(text, /\b(close supervision|under supervision|closely supervised|detailed instructions)\b/)) { freedom = Math.min(freedom, 1); reasonsFr.push('works under close supervision'); }

  const money = largestMoneyMillions(rawText);
  let mag: EvaluationInputs['acMagnitude'];
  const reasonsMag: string[] = [];
  if (money === null) {
    mag = tier <= 2 ? 'N' : tier <= 4 ? '1' : tier <= 6 ? '2' : tier <= 8 ? '3' : '4';
    reasonsMag.push('no budget / revenue figure found; estimated from seniority');
    warnings.push('No financial magnitude found in the description; magnitude was estimated.');
  } else {
    mag = money < 1 ? '1' : money < 10 ? '2' : money < 100 ? '3' : money < 1000 ? '4' : '5';
    reasonsMag.push(`largest figure found ≈ USD ${money < 1 ? money.toFixed(2) : Math.round(money)}M`);
  }

  let impact: EvaluationInputs['acImpact'] = 'C';
  const reasonsImp = ['advisory or supporting role by default'];
  if (tier >= 6 || has(text, /\b(accountable for|responsible for (the )?(delivery|results|p&l|profit|budget)|owns? the|p&l)\b/)) {
    impact = 'P'; reasonsImp.splice(0, 1, 'answerable for end results');
  } else if (has(text, /\b(jointly|shared responsibility|in partnership with|together with)\b/)) {
    impact = 'S'; reasonsImp.splice(0, 1, 'shares accountability with peers');
  } else if (tier <= 1) {
    impact = 'R'; reasonsImp.splice(0, 1, 'incidental / recording services');
  }
  if (mag === 'N') impact = '';

  // Keep the letter stair within one step.
  env = Math.max(tech - 1, Math.min(tech + 1, env));
  freedom = Math.max(tech - 1, Math.min(tech + 1, freedom));

  const inputs: EvaluationInputs = {
    ...EMPTY_INPUTS,
    khTechnical: L(tech),
    khBreadth: BREADTHS[breadth],
    khHumanRelations: String(hr) as EvaluationInputs['khHumanRelations'],
    psEnvironment: L(env),
    psChallenge: String(ch) as EvaluationInputs['psChallenge'],
    acFreedom: L(freedom),
    acMagnitude: mag,
    acImpact: impact,
  };

  const textLen = rawText.trim().split(/\s+/).length;
  if (textLen < 60) warnings.push('The description is short; levels rely mostly on the job title.');

  const join = (r: string[]) => r.join('; ');
  return {
    method: 'rules',
    inputs,
    rationale: {
      khTechnical: { level: inputs.khTechnical, reason: join(reasonsTech) },
      khBreadth: { level: inputs.khBreadth, reason: join(reasonsBreadth) },
      khHumanRelations: { level: inputs.khHumanRelations, reason: join(reasonsHr) },
      psEnvironment: { level: inputs.psEnvironment, reason: join(reasonsEnv) },
      psChallenge: { level: inputs.psChallenge, reason: join(reasonsCh) },
      acFreedom: { level: inputs.acFreedom, reason: join(reasonsFr) },
      acMagnitude: { level: inputs.acMagnitude, reason: join(reasonsMag) },
      acImpact: { level: inputs.acImpact || '—', reason: mag === 'N' ? 'not applicable when magnitude is N' : join(reasonsImp) },
    },
    summary: `Keyword and title based estimate (${tierWhy}).`,
    confidence: textLen >= 150 ? 'medium' : 'low',
    suggested: { title, department: '', jobFamily: '' },
    warnings,
  };
}

export async function analyseJobDescription(
  title: string,
  text: string,
  prefer: 'auto' | 'ai' | 'rules' = 'auto',
): Promise<JdAnalysis> {
  if (prefer === 'rules' || (prefer === 'auto' && !aiEnabled())) return analyseWithRules(title, text);
  if (prefer === 'ai' && !aiEnabled()) throw new Error('AI analysis is not configured on this server (set ANTHROPIC_API_KEY).');
  try {
    return await analyseWithClaude(title, text);
  } catch (err) {
    if (prefer === 'ai') throw err;
    const fallback = analyseWithRules(title, text);
    const reason =
      err instanceof Anthropic.APIError ? `AI service error (${err.status ?? 'network'})` : (err as Error).message;
    fallback.warnings.unshift(`${reason}; used the rule-based analyser instead.`);
    return fallback;
  }
}
