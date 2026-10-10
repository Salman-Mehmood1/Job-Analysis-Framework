/**
 * Demo organisation so the app has something to show on first run.
 * Runs only when the database has no organisations yet.
 *
 * Sign-ins (password "demo1234"):
 *   admin@demo.com · management@demo.com · evaluator@demo.com · evaluator2@demo.com
 */
import bcrypt from 'bcryptjs';
import { EMPTY_INPUTS, type EvaluationInputs } from '../shared/engine';
import { type DB, createStructure, openDb, seedDefaultGrades } from './db';
import { logHistory } from './services';

type Lv = [string, string, string, string, string, string, string, string, string?, string?];

const POSITIONS: {
  code: string;
  title: string;
  company: string;
  dept: string;
  family: string;
  jd: string;
  lv?: Lv; // KH tech, breadth, HR, PS env, challenge, AC freedom, magnitude, impact, khShade, acShade
  status?: 'assigned' | 'in_progress' | 'submitted' | 'approved';
  who?: 1 | 2;
}[] = [
  { code: 'FIN-01', title: 'Accounts Assistant', company: 'Acme Manufacturing', dept: 'Finance', family: 'Finance', jd: 'Processes supplier invoices and payments following established procedures. Reconciles petty cash and posts journal entries. Diploma in commerce; 2 years experience. Work is checked by the Accountant.', lv: ['C', 'I', '1', 'C', '2', 'B', '1', 'C'], status: 'approved', who: 1 },
  { code: 'FIN-05', title: 'Accountant', company: 'Acme Manufacturing', dept: 'Finance', family: 'Finance', jd: 'Prepares monthly management accounts, analyses variances and supervises two assistants. Chartered accountant (ACCA) with 4 years experience. Advises budget holders on a $12M cost base.', lv: ['E', 'I', '2', 'D', '3', 'D', '2', 'C'], status: 'approved', who: 1 },
  { code: 'FIN-10', title: 'Finance Manager', company: 'Acme Manufacturing', dept: 'Finance', family: 'Finance', jd: 'Leads the finance team of 8. Owns budgeting, reporting and controls. Qualified accountant, 10 years experience. Advises on a $40M cost base.', lv: ['F', 'II', '2', 'E', '4', 'E', '3', 'C'], status: 'approved', who: 1 },
  { code: 'OPS-20', title: 'Plant Manager', company: 'Acme Manufacturing', dept: 'Operations', family: 'Operations', jd: 'Integrates production, maintenance, quality and logistics at the plant. Accountable for the $60M operating cost and safety of 250 staff. Reports to the COO.', lv: ['F', 'III', '2', 'F', '3', 'F', '3', 'P'], status: 'approved', who: 2 },
  { code: 'OPS-05', title: 'Machine Operator', company: 'Acme Manufacturing', dept: 'Operations', family: 'Production', jd: 'Operates and monitors a packaging line following standard operating procedures. Reports faults to the shift supervisor.', lv: ['B', 'T', '1', 'B', '2', 'B', 'N', ''], status: 'submitted', who: 2 },
  { code: 'OPS-08', title: 'Shift Supervisor', company: 'Acme Manufacturing', dept: 'Operations', family: 'Production', jd: 'Supervises a shift of 20 operators, allocates work, enforces safety and resolves production issues. Diploma in engineering, 5 years experience.', lv: ['D', 'I', '2', 'C', '3', 'C', '2', 'C'], status: 'submitted', who: 2 },
  { code: 'OPS-12', title: 'Maintenance Engineer', company: 'Acme Manufacturing', dept: 'Operations', family: 'Engineering', jd: 'Plans preventive maintenance, diagnoses equipment failures and leads root-cause analysis. Bachelor of Engineering, 3 years experience.', lv: ['E', 'T', '2', 'D', '3', 'D', '2', 'C'], status: 'submitted', who: 1 },
  { code: 'QA-03', title: 'Quality Inspector', company: 'Acme Manufacturing', dept: 'Quality', family: 'Quality', jd: 'Inspects finished goods against specifications and records results.', lv: ['C', 'T', '1', 'C', '2', 'B', '1', 'R'], status: 'approved', who: 2 },
  { code: 'QA-10', title: 'Quality Manager', company: 'Acme Manufacturing', dept: 'Quality', family: 'Quality', jd: 'Owns the quality management system, leads audits and certification, manages a team of 6.', lv: ['F', 'I', '2', 'E', '3', 'E', '2', 'S'], status: 'in_progress', who: 1 },
  { code: 'HR-02', title: 'HR Officer', company: 'Acme Services', dept: 'Human Resources', family: 'Human Resources', jd: 'Handles recruitment administration, onboarding and employee queries. Degree in HR, 2 years experience.', lv: ['D', 'T', '2', 'D', '2', 'C', 'N', ''], status: 'approved', who: 1 },
  { code: 'HR-09', title: 'HR Manager', company: 'Acme Services', dept: 'Human Resources', family: 'Human Resources', jd: 'Leads HR operations, employee relations and talent programmes across the services company. Manages 5 staff and a $3M people budget.', lv: ['F', 'II', '3', 'E', '3', 'E', '2', 'P'], status: 'submitted', who: 2 },
  { code: 'IT-04', title: 'Software Developer', company: 'Acme Services', dept: 'Information Technology', family: 'Technology', jd: 'Designs, builds and tests internal applications. BSc Computer Science, 3 years experience.', lv: ['E', 'T', '1', 'D', '4', 'D', '1', 'C'], status: 'approved', who: 1 },
  { code: 'IT-07', title: 'Senior Software Developer', company: 'Acme Services', dept: 'Information Technology', family: 'Technology', jd: 'Leads technical design of core platforms, mentors developers, evaluates new technologies. 7 years experience.', lv: ['F', 'T', '2', 'E', '4', 'D', '2', 'C'], status: 'in_progress', who: 1 },
  { code: 'IT-12', title: 'Head of IT', company: 'Acme Services', dept: 'Information Technology', family: 'Technology', jd: 'Sets IT strategy and runs infrastructure, applications and service desk teams (30 staff). Accountable for an $8M IT budget.', status: 'assigned', who: 2 },
  { code: 'SAL-03', title: 'Sales Executive', company: 'Acme Services', dept: 'Sales', family: 'Sales', jd: 'Manages a portfolio of key accounts, negotiates contracts and achieves a $2M annual sales target.', lv: ['D', 'T', '3', 'D', '3', 'D', '2', 'S'], status: 'approved', who: 2 },
  { code: 'SAL-10', title: 'Sales Director', company: 'Acme Services', dept: 'Sales', family: 'Sales', jd: 'Leads national sales across three regions, sets commercial strategy and owns $120M revenue. Reports to the CEO.', status: 'assigned', who: 1 },
  { code: 'ADM-01', title: 'Office Attendant', company: 'Acme Services', dept: 'Administration', family: 'Support', jd: 'Delivers mail, maintains meeting rooms and assists with office logistics as instructed.', lv: ['A', 'T', '1', 'A', '1', 'A', 'N', ''], status: 'approved', who: 2 },
  { code: 'ADM-04', title: 'Receptionist', company: 'Acme Services', dept: 'Administration', family: 'Support', jd: 'Greets visitors, manages the switchboard and books meeting rooms.', lv: ['B', 'T', '2', 'B', '1', 'B', 'N', ''], status: 'submitted', who: 2 },
];

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

export function seedDemo(db: DB) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM organizations').get() as { n: number };
  if (n > 0) return;

  db.transaction(() => {
    const orgId = Number(db.prepare("INSERT INTO organizations (name) VALUES ('Acme Group (demo)')").run().lastInsertRowid);
    seedDefaultGrades(db, orgId);
    const hash = bcrypt.hashSync('demo1234', 10);
    const addUser = (name: string, email: string, role: string) =>
      Number(db.prepare('INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(orgId, name, email, hash, role).lastInsertRowid);
    const admin = addUser('Ayesha Khan (Admin)', 'admin@demo.com', 'admin');
    const mgmt = addUser('Omar Siddiqui (Management)', 'management@demo.com', 'management');
    const ev1 = addUser('Sara Ahmed', 'evaluator@demo.com', 'evaluator');
    const ev2 = addUser('Bilal Raza', 'evaluator2@demo.com', 'evaluator');

    const companies = new Map<string, number>();
    const depts = new Map<string, number>();
    for (const p of POSITIONS) {
      if (!companies.has(p.company)) {
        companies.set(p.company, Number(db.prepare('INSERT INTO companies (org_id, name) VALUES (?, ?)').run(orgId, p.company).lastInsertRowid));
      }
      const cId = companies.get(p.company)!;
      const key = `${p.company}/${p.dept}`;
      if (!depts.has(key)) {
        depts.set(key, Number(db.prepare('INSERT INTO departments (org_id, company_id, name) VALUES (?, ?, ?)').run(orgId, cId, p.dept).lastInsertRowid));
      }
      const posId = Number(
        db
          .prepare('INSERT INTO positions (org_id, company_id, department_id, code, title, job_family, job_description) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(orgId, cId, depts.get(key)!, p.code, p.title, p.family, p.jd).lastInsertRowid,
      );
      const evaluator = p.who === 2 ? ev2 : ev1;
      const status = p.status ?? 'assigned';
      const evId = Number(
        db
          .prepare(
            `INSERT INTO evaluations (org_id, position_id, evaluator_id, assigned_by, status, due_date, inputs, submitted_at, approved_at)
             VALUES (?, ?, ?, ?, ?, date('now', '+14 days'), ?, ?, ?)`,
          )
          .run(
            orgId,
            posId,
            evaluator,
            admin,
            status,
            p.lv ? JSON.stringify(toInputs(p.lv)) : null,
            ['submitted', 'approved'].includes(status) ? new Date().toISOString() : null,
            status === 'approved' ? new Date().toISOString() : null,
          ).lastInsertRowid,
      );
      logHistory(db, evId, admin, 'assigned', { evaluatorId: evaluator });
      if (['submitted', 'approved'].includes(status)) logHistory(db, evId, evaluator, 'submitted');
      if (status === 'approved') logHistory(db, evId, mgmt, 'approved');
    }

    // Extra grade structures: one assigned to individual blue-collar positions,
    // one the default for every job in Acme Services.
    const blueCollar = createStructure(db, orgId, 'Blue collar', 'Operators, technicians and support staff on hourly pay scales.', [
      { grade: 1, minPoints: 0, careerLevel: 'Entry', typicalRoles: 'Helper, attendant' },
      { grade: 2, minPoints: 90, careerLevel: 'Entry', typicalRoles: 'Labourer, packer' },
      { grade: 3, minPoints: 115, careerLevel: 'Semi-skilled', typicalRoles: 'Machine operator' },
      { grade: 4, minPoints: 145, careerLevel: 'Semi-skilled', typicalRoles: 'Senior operator' },
      { grade: 5, minPoints: 180, careerLevel: 'Skilled', typicalRoles: 'Inspector, technician' },
      { grade: 6, minPoints: 225, careerLevel: 'Skilled', typicalRoles: 'Senior technician' },
      { grade: 7, minPoints: 280, careerLevel: 'Lead hand', typicalRoles: 'Charge hand' },
      { grade: 8, minPoints: 350, careerLevel: 'Supervisory', typicalRoles: 'Shift supervisor' },
    ]);
    for (const code of ['OPS-05', 'OPS-08', 'QA-03', 'ADM-01']) {
      db.prepare('UPDATE positions SET grade_structure_id = ? WHERE org_id = ? AND code = ?').run(blueCollar, orgId, code);
    }
    const services = createStructure(db, orgId, 'Acme Services', 'Broader bands used across the services company.', [
      { grade: 1, minPoints: 0, careerLevel: 'Support', typicalRoles: 'Receptionist, office assistant' },
      { grade: 2, minPoints: 175, careerLevel: 'Associate', typicalRoles: 'Coordinator, officer' },
      { grade: 3, minPoints: 300, careerLevel: 'Professional', typicalRoles: 'Analyst, developer, HR officer' },
      { grade: 4, minPoints: 480, careerLevel: 'Senior professional', typicalRoles: 'Senior developer, sales executive' },
      { grade: 5, minPoints: 750, careerLevel: 'Manager', typicalRoles: 'Team manager' },
      { grade: 6, minPoints: 1150, careerLevel: 'Head of function', typicalRoles: 'Head of IT, HR manager' },
      { grade: 7, minPoints: 1750, careerLevel: 'Director', typicalRoles: 'Sales director' },
      { grade: 8, minPoints: 2700, careerLevel: 'Executive', typicalRoles: 'Managing director' },
    ]);
    db.prepare('UPDATE companies SET default_structure_id = ? WHERE id = ?').run(services, companies.get('Acme Services')!);

    // A job rated independently by both evaluators, ready for calibration.
    const procDept = depts.get('Acme Manufacturing/Finance')!;
    const procId = Number(
      db
        .prepare('INSERT INTO positions (org_id, company_id, department_id, code, title, job_family, job_description) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(orgId, companies.get('Acme Manufacturing')!, procDept, 'FIN-15', 'Procurement Manager', 'Supply chain',
          'Leads a team of 6 buyers, negotiates supplier contracts and is accountable for $30M annual spend. Degree and 8 years experience. Reports to the Finance Director.')
        .lastInsertRowid,
    );
    const ratings: [number, Lv][] = [
      [ev1, ['F', 'I', '3', 'E', '3', 'E', '3', 'S']],
      [ev2, ['E', 'I', '3', 'E', '4', 'E', '3', 'P']],
    ];
    for (const [who, lv] of ratings) {
      const evId = Number(
        db
          .prepare(
            `INSERT INTO evaluations (org_id, position_id, evaluator_id, assigned_by, status, due_date, inputs, submitted_at)
             VALUES (?, ?, ?, ?, 'submitted', date('now', '+14 days'), ?, ?)`,
          )
          .run(orgId, procId, who, admin, JSON.stringify(toInputs(lv)), new Date().toISOString()).lastInsertRowid,
      );
      logHistory(db, evId, admin, 'assigned', { evaluatorId: who });
      logHistory(db, evId, who, 'submitted');
    }
  })();
  console.log('Seeded demo organisation (admin@demo.com / management@demo.com / evaluator@demo.com, password demo1234)');
}

// `npm run seed`
if (process.argv[1]?.endsWith('seed.ts')) {
  seedDemo(openDb());
}
