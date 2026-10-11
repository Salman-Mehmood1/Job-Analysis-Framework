/**
 * Demo organisation so the app has something to show on first run.
 * Runs only when the database has no organisations yet.
 *
 * It holds a worked example of every scenario the app supports: single evaluations
 * at each stage (assigned, overdue, in progress, submitted, returned, adjusted,
 * approved), jobs rated by several evaluators (waiting for a rater, ready to
 * calibrate, calibration draft, approved calibration), questionnaire evaluations
 * with job holder and line manager responses, several grade structures and saved
 * job description analyses.
 *
 * Sign-ins (password "demo1234"): see DEMO_ACCOUNTS.
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GRADES, EMPTY_INPUTS, type EvaluationInputs, type GradeBand } from '../shared/engine';
import { type CadreInput, type PayBandInput, type PayModel, frameworkPayModel, generatePayBands } from '../shared/pay';
import {
  type Answers,
  EMPTY_EV_QUESTIONNAIRE,
  type ElementId,
  type EvaluatorQuestionnaire,
  type JobInfo,
  QUESTIONNAIRE,
  consolidate,
} from '../shared/questionnaire';
import { type DB, createStructure, openDb, seedDefaultGrades } from './db';
import { analyseWithRules } from './jd';
import { getJob } from './jobs';
import { getEvaluation } from './services';

export const DEMO_ACCOUNTS = [
  { key: 'admin', name: 'Ayesha Khan (Admin)', email: 'admin@demo.com', role: 'admin', note: 'administrator' },
  { key: 'mgmt', name: 'Omar Siddiqui (Management)', email: 'management@demo.com', role: 'management', note: 'management' },
  { key: 'sara', name: 'Sara Ahmed', email: 'evaluator@demo.com', role: 'evaluator', note: 'evaluator' },
  { key: 'bilal', name: 'Bilal Raza', email: 'evaluator2@demo.com', role: 'evaluator', note: 'evaluator' },
  { key: 'zainab', name: 'Zainab Hussain', email: 'evaluator3@demo.com', role: 'evaluator', note: 'evaluator' },
  { key: 'kamran', name: 'Kamran Ali', email: 'kamran@demo.com', role: 'respondent', note: 'line manager of the Head of IT' },
  { key: 'hina', name: 'Hina Malik', email: 'hina@demo.com', role: 'respondent', note: 'job holder, Head of IT' },
  { key: 'farah', name: 'Farah Naveed', email: 'farah@demo.com', role: 'respondent', note: 'line manager of the Senior Software Developer' },
  { key: 'usman', name: 'Usman Tariq', email: 'usman@demo.com', role: 'respondent', note: 'job holder, Senior Software Developer' },
  { key: 'tariq', name: 'Tariq Javed', email: 'tariq@demo.com', role: 'respondent', note: 'line manager of the Quality Manager' },
] as const;

type Who = (typeof DEMO_ACCOUNTS)[number]['key'];
type Rater = 'sara' | 'bilal' | 'zainab';
type Status = 'assigned' | 'in_progress' | 'submitted' | 'returned' | 'approved';

/** KH technical, breadth, human relations, PS environment, challenge, AC freedom, magnitude, impact, KH shade, AC shade. */
type Lv = [string, string, string, string, string, string, string, string, string?, string?];

function toInputs(lv: Lv): EvaluationInputs {
  return {
    ...EMPTY_INPUTS,
    khTechnical: lv[0],
    khBreadth: lv[1],
    khHumanRelations: lv[2],
    psEnvironment: lv[3],
    psChallenge: lv[4],
    acFreedom: lv[5],
    acMagnitude: lv[6],
    acImpact: lv[7],
    khShade: lv[8] ?? '',
    acShade: lv[9] ?? '',
  } as EvaluationInputs;
}

/** SQLite datetime a number of days before now (fractions allowed), like datetime('now'). */
function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
}
function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// --------------------------------------------------------------------- data

/** A band of a demo pay scenario: code, cadre, grades from–to, tier. */
type BandSpec = [string, string, number, number, string];
const band = ([code, cadre, gradeFrom, gradeTo, tier]: BandSpec, rounding: number): PayBandInput => ({ code, cadre, gradeFrom, gradeTo, tier, overlapOverride: null, rounding });
/** A framework cadre, optionally renamed and changed. */
const cadre = (from: string, patch: Partial<CadreInput> = {}): CadreInput => ({ ...frameworkPayModel().cadres.find((c) => c.name === from)!, ...patch });

interface StructureSpec {
  name: string;
  description: string;
  grades: GradeBand[];
  /** Salary bands built from this scenario's inputs (each structure uses different ones). */
  pay: PayModel;
}

const BLUE_COLLAR_GRADES: GradeBand[] = [
  { grade: 1, minPoints: 0, careerLevel: 'Entry', typicalRoles: 'Helper, attendant' },
  { grade: 2, minPoints: 90, careerLevel: 'Entry', typicalRoles: 'Labourer, packer, store assistant' },
  { grade: 3, minPoints: 115, careerLevel: 'Semi-skilled', typicalRoles: 'Machine operator, driver' },
  { grade: 4, minPoints: 145, careerLevel: 'Semi-skilled', typicalRoles: 'Senior operator' },
  { grade: 5, minPoints: 180, careerLevel: 'Skilled', typicalRoles: 'Inspector, technician' },
  { grade: 6, minPoints: 225, careerLevel: 'Skilled', typicalRoles: 'Electrician, senior technician' },
  { grade: 7, minPoints: 280, careerLevel: 'Lead hand', typicalRoles: 'Charge hand' },
  { grade: 8, minPoints: 350, careerLevel: 'Supervisory', typicalRoles: 'Shift supervisor' },
];
const MANAGER_GRADES: GradeBand[] = [
  { grade: 1, minPoints: 0, careerLevel: 'Team leader', typicalRoles: 'Team leader' },
  { grade: 2, minPoints: 400, careerLevel: 'Manager', typicalRoles: 'Section manager' },
  { grade: 3, minPoints: 600, careerLevel: 'Senior manager', typicalRoles: 'Quality manager, procurement manager' },
  { grade: 4, minPoints: 1000, careerLevel: 'Head of function', typicalRoles: 'Finance manager' },
  { grade: 5, minPoints: 1400, careerLevel: 'Director', typicalRoles: 'Plant manager' },
  { grade: 6, minPoints: 2000, careerLevel: 'Executive', typicalRoles: 'Chief operating officer' },
];
const SERVICES_GRADES: GradeBand[] = [
  { grade: 1, minPoints: 0, careerLevel: 'Support', typicalRoles: 'Receptionist, office assistant' },
  { grade: 2, minPoints: 175, careerLevel: 'Associate', typicalRoles: 'Coordinator, officer' },
  { grade: 3, minPoints: 300, careerLevel: 'Professional', typicalRoles: 'Analyst, developer, HR officer' },
  { grade: 4, minPoints: 480, careerLevel: 'Senior professional', typicalRoles: 'Senior developer, sales executive' },
  { grade: 5, minPoints: 750, careerLevel: 'Manager', typicalRoles: 'Team manager' },
  { grade: 6, minPoints: 1150, careerLevel: 'Head of function', typicalRoles: 'Head of IT, HR manager' },
  { grade: 7, minPoints: 1750, careerLevel: 'Director', typicalRoles: 'Sales director' },
  { grade: 8, minPoints: 2700, careerLevel: 'Executive', typicalRoles: 'Managing director' },
];

const STRUCTURES: Record<'blueCollar' | 'managers' | 'services' | 'retail', StructureSpec> = {
  // 8 grades in 3 narrow bands; 30–40% spreads, 15% overlap, gratuity instead of PF, a festival bonus,
  // everyone covered by social security. The anchor is below the Punjab minimum wage and is lifted.
  blueCollar: {
    name: 'Blue collar',
    description: 'Operators, drivers, technicians and support staff on hourly pay scales. 3 narrow bands, gratuity scheme, 1 month bonus.',
    grades: BLUE_COLLAR_GRADES,
    pay: {
      ...frameworkPayModel(),
      anchor: 38000,
      overlap: 0.15,
      tiers: [{ name: 'Entry', spread: 0.3 }, { name: 'Skilled', spread: 0.35 }, { name: 'Lead', spread: 0.4 }],
      retirement: 'Gratuity',
      bonusMonths: 1,
      bands: ([['W-1', 'Workers', 1, 3, 'Entry'], ['W-2', 'Skilled workers', 4, 6, 'Skilled'], ['W-3', 'Supervisors', 7, 8, 'Lead']] as BandSpec[]).map((b) => band(b, 1000)),
      cadres: [
        cadre('Staff', { name: 'Workers', designations: 'Helper, packer, machine operator, driver, store assistant, office attendant' }),
        cadre('Staff', { name: 'Skilled workers', designations: 'Senior operator, inspector, technician, electrician', mealRate: 300, hotelCap: 4000 }),
        cadre('Officer', { name: 'Supervisors', designations: 'Charge hand, shift supervisor', socialSecurity: true, ipdCover: 300000 }),
      ],
    },
  },
  // One band per grade with a tight 5% overlap, so each step is a clear promotion; PF and gratuity, 2 months bonus.
  managers: {
    name: 'Managers & leaders',
    description: 'People managers in Acme Manufacturing; individual contributors there stay on the Standard structure. One band per grade, 5% overlap.',
    grades: MANAGER_GRADES,
    pay: {
      ...frameworkPayModel(),
      anchor: 175000,
      overlap: 0.05,
      retirement: 'Both',
      pfRate: 0.1,
      bonusMonths: 2,
      bands: ([
        ['M-1', 'Manager', 1, 1, 'Mid'], ['M-2', 'Senior Manager', 2, 2, 'Mid'], ['M-3', 'DGM', 3, 3, 'Senior'],
        ['M-4', 'GM', 4, 4, 'Senior'], ['M-5', 'Chief', 5, 5, 'Senior'], ['M-6', 'Top Executive', 6, 6, 'Senior'],
      ] as BandSpec[]).map((b) => band(b, 5000)),
      cadres: ['Manager', 'Senior Manager', 'DGM', 'GM', 'Chief', 'Top Executive'].map((c) => cadre(c)),
    },
  },
  // Broadbanding: 8 grades in 4 wide bands (80–100% spreads, 25% overlap), Islamabad minimum wage, 10% PF, 2 months bonus.
  services: {
    name: 'Acme Services',
    description: 'Broad bands used across the services company (its company default): 4 bands, 80–100% spreads, Islamabad.',
    grades: SERVICES_GRADES,
    pay: {
      ...frameworkPayModel(),
      region: 'Islamabad (ICT)',
      anchor: 45000,
      overlap: 0.25,
      tiers: [{ name: 'Broad', spread: 0.8 }, { name: 'Broad senior', spread: 1 }],
      pfRate: 0.1,
      bonusMonths: 2,
      bands: ([['BB-1', 'Support', 1, 2, 'Broad'], ['BB-2', 'Professional', 3, 4, 'Broad'], ['BB-3', 'Management', 5, 6, 'Broad senior'], ['BB-4', 'Leadership', 7, 8, 'Broad senior']] as BandSpec[]).map((b) => band(b, 5000)),
      cadres: [
        cadre('Staff', { name: 'Support', designations: 'Receptionist, office assistant, coordinator' }),
        cadre('Executive', { name: 'Professional', designations: 'Developer, HR officer, analyst, sales executive' }),
        cadre('Manager', { name: 'Management', designations: 'Team manager, Head of IT, HR manager' }),
        cadre('GM', { name: 'Leadership', designations: 'Sales director, managing director' }),
      ],
    },
  },
  // The 23 standard grades regrouped into 8 bands for Sindh. The minimum-wage lift is switched off, so
  // the lowest band shows the "below minimum wage" check (Sindh 43,000 vs the 36,000 anchor).
  retail: {
    name: 'Acme Retail (Sindh)',
    description: 'Draft for the retail company in Sindh: 23 standard grades in 8 generated bands. The minimum-wage lift is off, so the lowest band fails the minimum-wage check.',
    grades: DEFAULT_GRADES,
    pay: {
      ...frameworkPayModel(),
      region: 'Sindh',
      liftToMinimumWage: false,
      bands: generatePayBands(DEFAULT_GRADES, 8),
      cadres: frameworkPayModel().cadres.filter((c) => generatePayBands(DEFAULT_GRADES, 8).some((b) => b.cadre === c.name)),
    },
  },
};
type StructureKey = keyof typeof STRUCTURES;

interface PositionSpec {
  code: string;
  title: string;
  company: string;
  dept: string;
  family: string;
  jd: string;
  /** Own grade structure; otherwise the company default or the organisation default (Standard). */
  structure?: StructureKey;
}

const POSITIONS: PositionSpec[] = [
  // Acme Manufacturing: Standard structure, blue-collar and manager roles on their own structures
  { code: 'FIN-01', title: 'Accounts Assistant', company: 'Acme Manufacturing', dept: 'Finance', family: 'Finance', jd: 'Processes supplier invoices and payments following established procedures. Reconciles petty cash and posts journal entries. Diploma in commerce; 2 years experience. Work is checked by the Accountant.' },
  { code: 'FIN-05', title: 'Accountant', company: 'Acme Manufacturing', dept: 'Finance', family: 'Finance', jd: 'Prepares monthly management accounts, analyses variances and supervises two assistants. Chartered accountant (ACCA) with 4 years experience. Advises budget holders on a $12M cost base.' },
  { code: 'FIN-10', title: 'Finance Manager', company: 'Acme Manufacturing', dept: 'Finance', family: 'Finance', jd: 'Leads the finance team of 8. Owns budgeting, reporting and controls. Qualified accountant, 10 years experience. Advises on a $40M cost base.' },
  { code: 'FIN-15', title: 'Procurement Manager', company: 'Acme Manufacturing', dept: 'Finance', family: 'Supply chain', structure: 'managers', jd: 'Leads a team of 6 buyers, negotiates supplier contracts and is accountable for $30M annual spend. Degree and 8 years experience. Reports to the Finance Director.' },
  { code: 'OPS-02', title: 'Forklift Driver', company: 'Acme Manufacturing', dept: 'Operations', family: 'Logistics', structure: 'blueCollar', jd: 'Loads, unloads and moves materials in the warehouse using a forklift, following safety rules and pick lists. Licensed forklift operator.' },
  { code: 'OPS-05', title: 'Machine Operator', company: 'Acme Manufacturing', dept: 'Operations', family: 'Production', structure: 'blueCollar', jd: 'Operates and monitors a packaging line following standard operating procedures. Reports faults to the shift supervisor.' },
  { code: 'OPS-08', title: 'Shift Supervisor', company: 'Acme Manufacturing', dept: 'Operations', family: 'Production', structure: 'blueCollar', jd: 'Supervises a shift of 20 operators, allocates work, enforces safety and resolves production issues. Diploma in engineering, 5 years experience.' },
  { code: 'OPS-12', title: 'Maintenance Engineer', company: 'Acme Manufacturing', dept: 'Operations', family: 'Engineering', jd: 'Plans preventive maintenance, diagnoses equipment failures and leads root-cause analysis. Bachelor of Engineering, 3 years experience.' },
  { code: 'OPS-15', title: 'Electrician', company: 'Acme Manufacturing', dept: 'Operations', family: 'Engineering', structure: 'blueCollar', jd: 'Installs, inspects and repairs electrical systems and motor controls across the plant. Works from drawings and the maintenance plan; follows lock-out procedures. Trade certificate and 4 years experience.' },
  { code: 'OPS-20', title: 'Plant Manager', company: 'Acme Manufacturing', dept: 'Operations', family: 'Operations', structure: 'managers', jd: 'Integrates production, maintenance, quality and logistics at the plant. Accountable for the $60M operating cost and safety of 250 staff. Reports to the COO.' },
  { code: 'QA-03', title: 'Quality Inspector', company: 'Acme Manufacturing', dept: 'Quality', family: 'Quality', structure: 'blueCollar', jd: 'Inspects finished goods against specifications and records results.' },
  { code: 'QA-10', title: 'Quality Manager', company: 'Acme Manufacturing', dept: 'Quality', family: 'Quality', structure: 'managers', jd: 'Owns the quality management system, leads audits and certification, manages a team of 6.' },
  // Acme Services: company default structure "Acme Services"
  { code: 'ADM-01', title: 'Office Attendant', company: 'Acme Services', dept: 'Administration', family: 'Support', structure: 'blueCollar', jd: 'Delivers mail, maintains meeting rooms and assists with office logistics as instructed.' },
  { code: 'ADM-04', title: 'Receptionist', company: 'Acme Services', dept: 'Administration', family: 'Support', jd: 'Greets visitors, manages the switchboard and books meeting rooms.' },
  { code: 'HR-02', title: 'HR Officer', company: 'Acme Services', dept: 'Human Resources', family: 'Human Resources', jd: 'Handles recruitment administration, onboarding and employee queries. Degree in HR, 2 years experience.' },
  { code: 'HR-09', title: 'HR Manager', company: 'Acme Services', dept: 'Human Resources', family: 'Human Resources', jd: 'Leads HR operations, employee relations and talent programmes across the services company. Manages 5 staff and a $3M people budget.' },
  { code: 'IT-04', title: 'Software Developer', company: 'Acme Services', dept: 'Information Technology', family: 'Technology', jd: 'Designs, builds and tests internal applications. BSc Computer Science, 3 years experience.' },
  { code: 'IT-07', title: 'Senior Software Developer', company: 'Acme Services', dept: 'Information Technology', family: 'Technology', jd: 'Leads technical design of core platforms, mentors developers, evaluates new technologies. 7 years experience.' },
  { code: 'IT-12', title: 'Head of IT', company: 'Acme Services', dept: 'Information Technology', family: 'Technology', jd: 'Sets IT strategy and runs infrastructure, applications and service desk teams (30 staff). Accountable for an $8M IT budget.' },
  { code: 'SAL-03', title: 'Sales Executive', company: 'Acme Services', dept: 'Sales', family: 'Sales', jd: 'Manages a portfolio of key accounts, negotiates contracts and achieves a $2M annual sales target.' },
  { code: 'SAL-06', title: 'Regional Sales Manager', company: 'Acme Services', dept: 'Sales', family: 'Sales', jd: 'Leads 8 sales executives in the northern region, sets account plans and owns a $15M regional revenue target. Reports to the Sales Director.' },
  { code: 'SAL-10', title: 'Sales Director', company: 'Acme Services', dept: 'Sales', family: 'Sales', jd: 'Leads national sales across three regions, sets commercial strategy and owns $120M revenue. Reports to the CEO.' },
  // Acme Retail: company default "Acme Retail (Sindh)"; the store assistant is on Blue collar
  { code: 'RET-01', title: 'Store Assistant', company: 'Acme Retail', dept: 'Stores', family: 'Retail', structure: 'blueCollar', jd: 'Serves customers, operates the till and replenishes shelves following store routines.' },
  { code: 'RET-05', title: 'Store Manager', company: 'Acme Retail', dept: 'Stores', family: 'Retail', jd: 'Runs a store of 25 staff: rosters, stock, visual standards and customer service. Accountable for $6M annual store sales.' },
  { code: 'RET-09', title: 'Area Manager', company: 'Acme Retail', dept: 'Stores', family: 'Retail', jd: 'Leads 8 store managers across the area, drives sales and standards, and owns $45M area sales.' },
  { code: 'RET-12', title: 'Head of Retail Operations', company: 'Acme Retail', dept: 'Retail Operations', family: 'Retail', jd: 'Sets the operating model for 60 stores, leads area managers and the store support team, and is accountable for $280M retail sales. Reports to the Managing Director.' },
];

interface EvalSpec {
  code: string;
  by: Rater;
  status: Status;
  lv?: Lv;
  /** Days ago the evaluation was assigned. */
  assigned: number;
  /** Days from now it is due (negative = overdue). */
  due?: number;
  submitted?: number;
  approved?: number;
  rationale?: string;
  instructions?: string;
  /** Management's adjustment of a single evaluation. */
  adjust?: { lv: Lv; comment: string; at: number };
  /** Management sent it back. */
  returned?: { comment: string; at: number };
}

/** Jobs with one evaluator each. */
const SINGLE: EvalSpec[] = [
  // approved
  { code: 'FIN-01', by: 'sara', status: 'approved', lv: ['C', 'I', '1', 'C', '2', 'B', '1', 'C'], assigned: 60, submitted: 52, approved: 45 },
  { code: 'FIN-05', by: 'sara', status: 'approved', lv: ['E', 'I', '2', 'D', '3', 'D', '2', 'C'], assigned: 60, submitted: 50, approved: 44,
    rationale: 'Professional accounting knowledge; prepares the monthly accounts and advises budget holders.',
    adjust: { lv: ['E', 'I', '2', 'D', '3', 'D', '2', 'S'], comment: 'Advises budget holders across the whole $12M cost base, so the impact is shared rather than contributory.', at: 44.2 } },
  { code: 'FIN-10', by: 'sara', status: 'approved', lv: ['F', 'II', '2', 'E', '4', 'E', '3', 'C'], assigned: 58, submitted: 49, approved: 43 },
  { code: 'OPS-02', by: 'zainab', status: 'approved', lv: ['B', 'T', '1', 'B', '2', 'B', 'N', ''], assigned: 40, submitted: 33, approved: 30 },
  { code: 'QA-03', by: 'bilal', status: 'approved', lv: ['C', 'T', '1', 'C', '2', 'B', '1', 'R'], assigned: 55, submitted: 47, approved: 42 },
  { code: 'ADM-01', by: 'bilal', status: 'approved', lv: ['A', 'T', '1', 'A', '1', 'A', 'N', ''], assigned: 55, submitted: 48, approved: 42 },
  { code: 'HR-02', by: 'sara', status: 'approved', lv: ['D', 'T', '2', 'D', '2', 'C', 'N', ''], assigned: 50, submitted: 41, approved: 36 },
  { code: 'IT-04', by: 'sara', status: 'approved', lv: ['E', 'T', '1', 'D', '4', 'D', '1', 'C'], assigned: 50, submitted: 40, approved: 36,
    rationale: 'Degree-level software engineering; designs and tests applications within the team’s standards.' },
  { code: 'SAL-03', by: 'bilal', status: 'approved', lv: ['D', 'T', '3', 'D', '3', 'D', '2', 'S'], assigned: 48, submitted: 39, approved: 35 },
  { code: 'RET-01', by: 'bilal', status: 'approved', lv: ['B', 'T', '2', 'B', '1', 'B', 'N', ''], assigned: 35, submitted: 27, approved: 21 },
  { code: 'RET-05', by: 'sara', status: 'approved', lv: ['D', 'I', '3', 'D', '3', 'D', '2', 'P'], assigned: 35, submitted: 26, approved: 21 },
  // submitted, waiting for management
  { code: 'OPS-05', by: 'bilal', status: 'submitted', lv: ['B', 'T', '1', 'B', '2', 'B', 'N', ''], assigned: 30, submitted: 9 },
  { code: 'OPS-12', by: 'sara', status: 'submitted', lv: ['E', 'T', '2', 'D', '3', 'D', '2', 'C'], assigned: 30, submitted: 8,
    adjust: { lv: ['E', 'I', '2', 'D', '3', 'D', '2', 'C'], comment: 'Covers mechanical and electrical maintenance across all lines: breadth I. Approve after the engineering lead confirms.', at: 3 } },
  { code: 'ADM-04', by: 'bilal', status: 'submitted', lv: ['B', 'T', '2', 'B', '1', 'B', 'N', ''], assigned: 28, submitted: 6 },
  { code: 'RET-09', by: 'zainab', status: 'submitted', lv: ['E', 'II', '3', 'E', '3', 'E', '3', 'C'], assigned: 25, submitted: 4,
    rationale: 'Leads 8 store managers; drives sales through them rather than directly.' },
  // sent back for rework
  { code: 'OPS-08', by: 'bilal', status: 'returned', lv: ['D', 'I', '2', 'C', '3', 'C', '2', 'C'], assigned: 30, submitted: 12,
    returned: { comment: 'Supervises 20 operators and resolves shift issues on their own. Please revisit Problem Solving (environment C looks low) and add your rationale.', at: 5 } },
  // started, not submitted
  { code: 'OPS-15', by: 'zainab', status: 'in_progress', lv: ['D', 'T', '2', '', '', '', '', ''], assigned: 14, due: 7 },
  // not started; one overdue
  { code: 'SAL-06', by: 'sara', status: 'assigned', assigned: 10, due: 4, instructions: 'Compare with the Sales Executive (SAL-03) and Sales Director (SAL-10).' },
  { code: 'RET-12', by: 'zainab', status: 'assigned', assigned: 20, due: -2 },
];

/** Jobs rated independently by several evaluators and calibrated by management. */
const MULTI: {
  code: string;
  raters: { by: Rater; status: Status; lv?: Lv; submitted?: number }[];
  assigned: number;
  due?: number;
  calibration?: { adjust?: Partial<EvaluationInputs>; comment: string; at: number; approved?: number };
}[] = [
  // two submitted, ready for management to calibrate (most-common level ties are resolved near the median)
  { code: 'FIN-15', assigned: 21, raters: [
    { by: 'sara', status: 'submitted', lv: ['F', 'I', '3', 'E', '3', 'E', '3', 'S'], submitted: 7 },
    { by: 'bilal', status: 'submitted', lv: ['E', 'I', '3', 'E', '4', 'E', '3', 'P'], submitted: 6 },
  ] },
  // three raters, calibrated and approved with one element adjusted: evaluators now see the calibrated result
  { code: 'OPS-20', assigned: 45, raters: [
    { by: 'sara', status: 'approved', lv: ['F', 'III', '2', 'F', '3', 'F', '3', 'P'], submitted: 34 },
    { by: 'bilal', status: 'approved', lv: ['F', 'III', '2', 'E', '3', 'F', '3', 'P'], submitted: 33 },
    { by: 'zainab', status: 'approved', lv: ['F', 'III', '2', 'F', '4', 'F', '3', 'S'], submitted: 31 },
  ], calibration: { adjust: { psChallenge: '4' }, comment: 'Agreed at the calibration panel: the plant turnaround needs new approaches rather than adapting existing ones, so Problem Solving challenge is 4.', at: 26, approved: 25 } },
  // two raters far apart: management has saved a draft calibration, not yet approved
  { code: 'HR-09', assigned: 24, raters: [
    { by: 'bilal', status: 'submitted', lv: ['F', 'II', '3', 'E', '3', 'E', '2', 'P'], submitted: 10 },
    { by: 'zainab', status: 'submitted', lv: ['E', 'I', '3', 'D', '3', 'D', '2', 'C'], submitted: 9 },
  ], calibration: { adjust: { khBreadth: 'II' }, comment: 'Draft: covers HR for the whole services company, so breadth II. To discuss Problem Solving with both evaluators before approving.', at: 2 } },
  // still waiting for one of three evaluators (overdue)
  { code: 'SAL-10', assigned: 18, due: -3, raters: [
    { by: 'sara', status: 'submitted', lv: ['G', 'II', '3', 'F', '4', 'F', '4', 'P'], submitted: 5 },
    { by: 'bilal', status: 'submitted', lv: ['G', 'II', '3', 'F', '4', 'G', '4', 'P'], submitted: 4 },
    { by: 'zainab', status: 'assigned' },
  ] },
];

// Questionnaire answers: element → the five question levels (1-based). PS-C Q4 is evaluator-only.
type Levels = Partial<Record<ElementId, (number | null)[]>>;
function answersFrom(levels: Levels, respondent: boolean): Answers {
  const out: Answers = {};
  for (const el of QUESTIONNAIRE) {
    el.questions.forEach((q, i) => {
      const v = levels[el.id]?.[i];
      if (v != null && !(respondent && q.evaluatorOnly)) out[q.id] = v;
    });
  }
  return out;
}

function magnitudeSheet(measure: string, usd: number, influence: 'direct' | 'shared' | 'advisory', level: EvaluatorQuestionnaire['magnitude']['level'], source: string) {
  const figures = EMPTY_EV_QUESTIONNAIRE.magnitude.figures.map((f) => (f.measure === measure ? { ...f, usd, influence } : { ...f }));
  return { figures, primary: figures.findIndex((f) => f.measure === measure), level, source };
}

// ------------------------------------------------------------------- seeding

export function seedDemo(db: DB) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM organizations').get() as { n: number };
  if (n > 0) return;

  db.transaction(() => {
    const orgId = Number(db.prepare("INSERT INTO organizations (name, created_at) VALUES ('Acme Group (demo)', ?)").run(ago(70)).lastInsertRowid);
    // Standard: the organisation default, with the workbook's 11 salary bands over its 23 grades.
    const standard = seedDefaultGrades(db, orgId);
    db.prepare('UPDATE grade_structures SET description = ?, pay = ? WHERE id = ?').run(
      'The organisation-wide structure: 23 job grades in 11 salary bands (Grading & Rewards Framework, Punjab).',
      JSON.stringify(frameworkPayModel()),
      standard,
    );

    // users
    const hash = bcrypt.hashSync('demo1234', 10);
    const user = {} as Record<Who, number>;
    for (const a of DEMO_ACCOUNTS) {
      user[a.key] = Number(
        db.prepare('INSERT INTO users (org_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(orgId, a.name, a.email, hash, a.role, ago(70)).lastInsertRowid,
      );
    }
    const { admin, mgmt } = user;

    // grade structures (Standard is the organisation default)
    const structureId = {} as Record<StructureKey, number>;
    for (const [key, s] of Object.entries(STRUCTURES) as [StructureKey, (typeof STRUCTURES)[StructureKey]][]) {
      structureId[key] = createStructure(db, orgId, s.name, s.description, s.grades.map((g) => ({ ...g })), false, s.pay);
    }

    // companies, departments, positions
    const companies = new Map<string, number>();
    const depts = new Map<string, number>();
    const posId = new Map<string, number>();
    const addPosition = (p: PositionSpec) => {
      if (!companies.has(p.company)) {
        companies.set(p.company, Number(db.prepare('INSERT INTO companies (org_id, name) VALUES (?, ?)').run(orgId, p.company).lastInsertRowid));
      }
      const cId = companies.get(p.company)!;
      const key = `${p.company}/${p.dept}`;
      if (!depts.has(key)) {
        depts.set(key, Number(db.prepare('INSERT INTO departments (org_id, company_id, name) VALUES (?, ?, ?)').run(orgId, cId, p.dept).lastInsertRowid));
      }
      const id = Number(
        db
          .prepare('INSERT INTO positions (org_id, company_id, department_id, code, title, job_family, job_description, grade_structure_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(orgId, cId, depts.get(key)!, p.code, p.title, p.family, p.jd, p.structure ? structureId[p.structure] : null, ago(65)).lastInsertRowid,
      );
      posId.set(p.code, id);
      return id;
    };
    POSITIONS.forEach(addPosition);
    db.prepare('UPDATE companies SET default_structure_id = ? WHERE id = ?').run(structureId.services, companies.get('Acme Services')!);
    db.prepare('UPDATE companies SET default_structure_id = ? WHERE id = ?').run(structureId.retail, companies.get('Acme Retail')!);

    // helpers
    const history = (evId: number, who: number, action: string, at: number, details: object = {}) =>
      db.prepare('INSERT INTO evaluation_history (evaluation_id, user_id, action, details, at) VALUES (?, ?, ?, ?, ?)').run(evId, who, action, JSON.stringify(details), ago(at));
    const scored = (evId: number) => {
      const e = getEvaluation(db, orgId, evId)!;
      return { totalPoints: e.result?.totalPoints, grade: e.result?.grade };
    };

    const addEvaluation = (s: EvalSpec & { method?: 'direct' | 'questionnaire'; questionnaire?: EvaluatorQuestionnaire; inputs?: EvaluationInputs }) => {
      const evaluator = user[s.by];
      const inputs = s.inputs ?? (s.lv ? toInputs(s.lv) : null);
      const started = s.status !== 'assigned';
      const submitted = ['submitted', 'approved', 'returned'].includes(s.status) ? s.submitted ?? 1 : null;
      const id = Number(
        db
          .prepare(
            `INSERT INTO evaluations (org_id, position_id, evaluator_id, assigned_by, status, due_date, instructions, inputs, rationale, method, questionnaire,
               submitted_at, approved_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            orgId, posId.get(s.code)!, evaluator, admin, s.status,
            dateIn(s.due ?? (submitted !== null ? 14 - s.assigned : 14)),
            s.instructions ?? '',
            inputs ? JSON.stringify(inputs) : null,
            s.rationale ?? '',
            s.method ?? 'direct',
            s.questionnaire ? JSON.stringify(s.questionnaire) : null,
            submitted !== null ? ago(submitted) : null,
            s.status === 'approved' && s.approved != null ? ago(s.approved) : null,
            ago(s.assigned),
            ago(Math.min(s.approved ?? Infinity, s.returned?.at ?? Infinity, s.adjust?.at ?? Infinity, submitted ?? Infinity, started ? s.assigned - 1 : s.assigned)),
          ).lastInsertRowid,
      );
      history(id, admin, 'assigned', s.assigned, { evaluatorId: evaluator });
      if (started) history(id, evaluator, 'started', s.assigned - 1);
      if (submitted !== null) history(id, evaluator, 'submitted', submitted, scored(id));
      return id;
    };

    // single-evaluator jobs, with management's adjustments, returns and approvals
    for (const s of SINGLE) {
      const id = addEvaluation(s);
      if (s.adjust) {
        const before = scored(id);
        db.prepare('UPDATE evaluations SET adjusted_inputs = ?, adjusted_by = ?, adjusted_at = ?, review_comment = ? WHERE id = ?').run(
          JSON.stringify(toInputs(s.adjust.lv)), mgmt, ago(s.adjust.at), s.adjust.comment, id,
        );
        const after = scored(id);
        history(id, mgmt, 'adjusted', s.adjust.at, { fromPoints: before.totalPoints, toPoints: after.totalPoints, fromGrade: before.grade, toGrade: after.grade, comment: s.adjust.comment });
      }
      if (s.returned) {
        db.prepare('UPDATE evaluations SET review_comment = ? WHERE id = ?').run(s.returned.comment, id);
        history(id, mgmt, 'returned', s.returned.at, { comment: s.returned.comment });
      }
      if (s.status === 'approved') history(id, mgmt, 'approved', s.approved!, scored(id));
    }

    // multi-evaluator jobs and their calibrations
    for (const m of MULTI) {
      const ids = m.raters.map((r) => addEvaluation({ code: m.code, by: r.by, status: r.status, lv: r.lv, submitted: r.submitted, assigned: m.assigned, due: m.due }));
      if (!m.calibration) continue;
      const c = m.calibration;
      const pId = posId.get(m.code)!;
      const consensus = getJob(db, orgId, pId)!.consensus!.inputs;
      const adjusted = c.adjust ? { ...consensus, ...c.adjust } : null;
      db.prepare(
        `INSERT INTO calibrations (org_id, position_id, status, adjusted_inputs, comment, final_inputs, included_ids, updated_by, updated_at, approved_by, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        orgId, pId, c.approved != null ? 'approved' : 'open',
        adjusted ? JSON.stringify(adjusted) : null, c.comment,
        c.approved != null ? JSON.stringify(adjusted ?? consensus) : null,
        c.approved != null ? JSON.stringify(ids) : null,
        mgmt, ago(c.approved ?? c.at),
        c.approved != null ? mgmt : null, c.approved != null ? ago(c.approved) : null,
      );
      if (c.approved != null) {
        for (const id of ids) {
          db.prepare('UPDATE evaluations SET approved_at = ?, updated_at = ? WHERE id = ?').run(ago(c.approved), ago(c.approved), id);
          history(id, mgmt, 'calibrated', c.approved, { evaluators: ids.length });
        }
      }
    }

    // --------------------------------------------------- questionnaire pack
    const invite = (code: string, who: Who, role: 'JH' | 'LM', at: number, due: number) =>
      Number(
        db
          .prepare('INSERT INTO questionnaire_responses (org_id, position_id, user_id, role, due_date, invited_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(orgId, posId.get(code)!, user[who], role, dateIn(due), admin, ago(at), ago(at)).lastInsertRowid,
      );
    const respond = (id: number, levels: Levels, jobInfo: JobInfo, complexProblem: string, at: number, submit: boolean) =>
      db
        .prepare('UPDATE questionnaire_responses SET answers = ?, job_info = ?, complex_problem = ?, status = ?, updated_at = ?, submitted_at = ? WHERE id = ?')
        .run(JSON.stringify(answersFrom(levels, true)), JSON.stringify(jobInfo), complexProblem, submit ? 'submitted' : 'in_progress', ago(at), submit ? ago(at) : null, id);
    const questionnaireEvaluation = (s: EvalSpec, ev: EvaluatorQuestionnaire, jh: Levels[], lm: Levels[]) => {
      const result = consolidate(ev, jh.map((l) => answersFrom(l, true)), lm.map((l) => answersFrom(l, true)));
      return addEvaluation({ ...s, method: 'questionnaire', questionnaire: ev, inputs: result.inputs });
    };

    // 1. Head of IT: line manager has submitted, the job holder has not started (job holders are optional);
    //    Bilal has rated Know-How so far.
    const kamranLevels: Levels = {
      KH_T: [6, 6, 6, 5, 6], KH_B: [3, 3, 4, 3, 4], KH_H: [3, 2, 2, 3, 3], PS_E: [6, 5, 6, 6, 5],
      PS_C: [4, 4, 4, null, 3], AC_F: [6, 5, 6, 6, 6], AC_I: [4, 4, 4, 3, 4],
    };
    const lmIt12 = invite('IT-12', 'kamran', 'LM', 16, 2);
    respond(lmIt12, kamranLevels, {
      purpose: 'Provide reliable, secure technology that lets Acme Services run and grow.',
      accountabilities: 'Set the IT strategy and roadmap\nRun infrastructure, applications and service desk to agreed service levels\nDeliver the $8M IT budget\nProtect systems and data from security threats',
      directReports: '3 managers: infrastructure, applications, service desk',
      totalStaff: '30',
    }, 'Replaced the ageing ERP within the year without disrupting billing: weighed three vendors, negotiated the contract and phased the cut-over around month-end close.', 6, true);
    invite('IT-12', 'hina', 'JH', 16, 2);
    questionnaireEvaluation(
      { code: 'IT-12', by: 'bilal', status: 'in_progress', assigned: 16, due: 9 },
      { ...EMPTY_EV_QUESTIONNAIRE, answers: answersFrom({ KH_T: [6, 6, 5, 5, 6], KH_B: [3, 3, 3, null, null] }, false) },
      [], [kamranLevels],
    );

    // 2. Senior Software Developer: job holder, line manager and evaluator have all answered; the evaluator
    //    raised Area of Impact by one step with a rationale and submitted. One KH-T question diverges (JH vs LM).
    const usmanLevels: Levels = {
      KH_T: [7, 6, 6, 8, 6], KH_B: [1, 2, 1, 1, 1], KH_H: [2, 2, 3, 2, 2], PS_E: [5, 6, 5, 5, 5],
      PS_C: [4, 4, 5, null, 4], AC_F: [5, 4, 5, 4, 4], AC_I: [2, 3, 2, 2, 2],
    };
    const farahLevels: Levels = {
      KH_T: [5, 5, 5, 6, 5], KH_B: [1, 1, 1, 2, 1], KH_H: [2, 2, 2, 2, 1], PS_E: [5, 5, 5, 4, 5],
      PS_C: [4, 3, 4, null, 4], AC_F: [4, 4, 4, 4, 3], AC_I: [2, 2, 2, 2, 1],
    };
    const saraLevels: Levels = {
      KH_T: [5, 5, 6, 5, 5], KH_B: [1, 1, 1, 1, 1], KH_H: [2, 2, 2, 2, 2], PS_E: [5, 5, 5, 5, 4],
      PS_C: [4, 4, 4, 4, 3], AC_F: [4, 4, 4, 4, 4], AC_I: [2, 2, 2, 2, 2],
    };
    const jhIt07 = invite('IT-07', 'usman', 'JH', 28, -14);
    const lmIt07 = invite('IT-07', 'farah', 'LM', 28, -14);
    respond(jhIt07, usmanLevels, {
      purpose: 'Design and build the core order-management platform so it scales with the business.',
      accountabilities: 'Lead technical design of the platform\nReview code and mentor four developers\nEvaluate and recommend new technologies\nResolve production incidents on the platform',
      directReports: 'None (mentors 4 developers)',
      totalStaff: '0',
      internalContacts: 'Product managers on priorities; operations on incidents',
      systems: 'Cloud platform, CI/CD, event streaming',
    }, 'Moved order processing from a nightly batch to real-time events without downtime: designed the event model, ran both systems in parallel for a month and reconciled every order.', 17, true);
    respond(lmIt07, farahLevels, {
      purpose: 'Technical lead for the order-management platform.',
      accountabilities: 'Technical design and code quality of the platform\nMentoring developers\nTechnology recommendations to the Head of IT',
      directReports: 'None',
      totalStaff: '0',
    }, 'The real-time order processing change: Usman designed it; the architecture board approved the approach.', 15, true);
    const it07Ev: EvaluatorQuestionnaire = {
      answers: answersFrom(saraLevels, false),
      magnitude: magnitudeSheet('Capital or project spend', 600_000, 'shared', '1', 'Platform programme budget FY26 (Finance)'),
      overrides: {},
    };
    const it07Base = consolidate(it07Ev, [answersFrom(usmanLevels, true)], [answersFrom(farahLevels, true)]);
    const aiLevel = it07Base.elements.AC_I.computedLevel!;
    it07Ev.overrides = {
      AC_I: { level: Math.min(aiLevel + 1, 4), shade: '', rationale: 'Owns the platform design that order processing depends on; shares the result with the Head of IT rather than only contributing advice.' },
    };
    questionnaireEvaluation(
      { code: 'IT-07', by: 'sara', status: 'submitted', assigned: 28, submitted: 3,
        rationale: 'Questionnaire with job holder and line manager. Job holder rated KH-T Q4 two levels above the line manager; the median was used.' },
      it07Ev, [usmanLevels], [farahLevels],
    );

    // 3. Quality Manager: no job holder invited; the line manager has a draft saved (not visible to the
    //    evaluator until submitted); Zainab has rated part of the questionnaire.
    const lmQa10 = invite('QA-10', 'tariq', 'LM', 12, 3);
    respond(lmQa10, { KH_T: [6, 6, 5, 6, 6], KH_B: [2, 2, 2, 1, 2], KH_H: [2, 3, 2, 2, 2] }, {
      purpose: 'Keep products compliant and the plant certified (ISO 9001, customer audits).',
      directReports: '2 quality engineers, 4 inspectors',
      totalStaff: '6',
    }, '', 4, false);
    questionnaireEvaluation(
      { code: 'QA-10', by: 'zainab', status: 'in_progress', assigned: 12, due: 10 },
      { ...EMPTY_EV_QUESTIONNAIRE, answers: answersFrom({ KH_T: [6, 6, 6, 5, 6], KH_B: [2, 2, 2, 2, 2], KH_H: [2, 2, 3, 2, 2], PS_E: [5, 5, null, null, null] }, false) },
      [], [],
    );

    // ---------------------------------------------- job description analyses
    const saveAnalysis = (who: Who, title: string, text: string, at: number, link?: { positionId?: number; structure?: StructureKey }) => {
      const analysis = analyseWithRules(title, text);
      const id = Number(
        db
          .prepare('INSERT INTO jd_analyses (org_id, user_id, position_id, title, jd_text, method, result, structure_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(orgId, user[who], link?.positionId ?? null, title, text, analysis.method, JSON.stringify(analysis), link?.structure ? structureId[link.structure] : null, ago(at)).lastInsertRowid,
      );
      return { id, analysis };
    };

    // Management analysed a new job description and filed it as an evaluation (creating the position).
    const logJd = 'Coordinates inbound and outbound shipments for the plant: books carriers, prepares shipping documents and tracks deliveries against schedule. Resolves delivery problems with carriers and customers. Diploma and 2 years experience in logistics. Reports to the Plant Manager.';
    const log = saveAnalysis('mgmt', 'Logistics Coordinator', logJd, 11);
    const logPos = addPosition({ code: 'LOG-06', title: 'Logistics Coordinator', company: 'Acme Manufacturing', dept: 'Operations', family: 'Logistics', jd: logJd });
    db.prepare('UPDATE jd_analyses SET position_id = ? WHERE id = ?').run(logPos, log.id);
    const rationale = Object.entries(log.analysis.rationale).map(([k, v]) => `${k} ${v.level}: ${v.reason}`).join('\n');
    const logEval = Number(
      db
        .prepare(
          `INSERT INTO evaluations (org_id, position_id, evaluator_id, assigned_by, status, inputs, rationale, source, submitted_at, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'submitted', ?, ?, 'jd_analysis', ?, ?, ?)`,
        )
        .run(orgId, logPos, mgmt, JSON.stringify(log.analysis.inputs), `${log.analysis.summary}\n\n${rationale}`, ago(11), ago(11), ago(11)).lastInsertRowid,
    );
    history(logEval, mgmt, 'created_from_jd_analysis', 11, { analysisId: log.id, method: log.analysis.method });

    // A stand-alone analysis graded against the Acme Services structure, not filed.
    saveAnalysis('mgmt', 'Data Analyst',
      'Builds dashboards and analyses sales, customer and operational data for the services company. Writes SQL, validates data quality and presents findings to managers. Degree in statistics or computer science and 3 years experience. Reports to the Head of IT.',
      7, { structure: 'services' });
    // An evaluator checking a job description for a position assigned to them.
    saveAnalysis('zainab', 'Electrician', POSITIONS.find((p) => p.code === 'OPS-15')!.jd, 13, { positionId: posId.get('OPS-15') });
    // The administrator analysing a draft job description before the position exists.
    saveAnalysis('admin', 'Customer Service Agent',
      'Answers customer calls and emails, logs requests and resolves routine queries using scripts and the knowledge base. Escalates complaints to the team leader. High-school education; 1 year experience.',
      2, { structure: 'blueCollar' });
  })();
  console.log(`Created the demo organisation. Sign in with any of these (password demo1234):\n${demoAccountList()}`);
}

export function demoAccountList() {
  return DEMO_ACCOUNTS.map((a) => `  ${a.email.padEnd(22)} ${a.note}`).join('\n');
}

/**
 * Databases created by an earlier version of the demo miss accounts added later.
 * Adds the job holder / line manager demo accounts (and their Head of IT questionnaire
 * requests) to the existing demo organisation. Never touches other organisations.
 */
export function topUpDemo(db: DB) {
  const demo = db.prepare("SELECT org_id FROM users WHERE email = 'admin@demo.com'").get() as { org_id: number } | undefined;
  if (!demo) return;
  const orgId = demo.org_id;
  const admin = (db.prepare("SELECT id FROM users WHERE email = 'admin@demo.com'").get() as { id: number }).id;
  const added: string[] = [];
  const ensure = (name: string, email: string) => {
    const row = db.prepare('SELECT id, org_id FROM users WHERE email = ?').get(email) as { id: number; org_id: number } | undefined;
    if (row) return row.org_id === orgId ? row.id : null;
    added.push(email);
    return Number(
      db
        .prepare("INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'respondent')")
        .run(orgId, name, email, bcrypt.hashSync('demo1234', 10)).lastInsertRowid,
    );
  };
  db.transaction(() => {
    const jobHolder = ensure('Hina Malik', 'hina@demo.com');
    const lineManager = ensure('Kamran Ali', 'kamran@demo.com');
    const headOfIt = db.prepare("SELECT id FROM positions WHERE org_id = ? AND code = 'IT-12'").get(orgId) as { id: number } | undefined;
    if (!headOfIt || !jobHolder || !lineManager) return;
    if (db.prepare('SELECT 1 FROM questionnaire_responses WHERE position_id = ?').get(headOfIt.id)) return;
    db.prepare(
      "UPDATE evaluations SET method = 'questionnaire' WHERE position_id = ? AND status IN ('assigned','in_progress','returned') AND inputs IS NULL",
    ).run(headOfIt.id);
    const invite = db.prepare(
      "INSERT INTO questionnaire_responses (org_id, position_id, user_id, role, due_date, invited_by) VALUES (?, ?, ?, ?, date('now', '+7 days'), ?)",
    );
    invite.run(orgId, headOfIt.id, lineManager, 'LM', admin);
    invite.run(orgId, headOfIt.id, jobHolder, 'JH', admin);
  })();
  if (added.length) console.log(`Added demo accounts to your existing demo organisation: ${added.join(', ')} (password demo1234)`);
  // Older demos lack the third evaluator or the salary bands.
  if (
    !db.prepare("SELECT 1 FROM users WHERE email = 'evaluator3@demo.com'").get() ||
    !db.prepare('SELECT 1 FROM grade_structures WHERE org_id = ? AND pay IS NOT NULL').get(orgId)
  ) {
    console.log('This database holds an older, smaller demo. To rebuild it with every scenario, stop the app and run "npm run reset-demo" (this deletes everything in the database).');
  }
}

// `npm run seed` adds the demo organisation if the database is empty;
// `npm run reset-demo` deletes the database first and starts again from the demo data.
if (process.argv[1]?.endsWith('seed.ts')) {
  const file = process.env.DB_FILE ?? path.resolve('data/job-evaluation.db');
  if (process.argv.includes('--reset') && file !== ':memory:') {
    try {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      console.error(
        code === 'EBUSY' || code === 'EPERM'
          ? 'Could not delete the database because it is in use. Stop the app first (Ctrl+C in the window where it runs), then run "npm run reset-demo" again.'
          : `Could not delete ${file}: ${(err as Error).message}`,
      );
      process.exit(1);
    }
    console.log(`Deleted ${file}`);
  }
  const db = openDb(file);
  seedDemo(db);
  topUpDemo(db);
  db.close();
}
