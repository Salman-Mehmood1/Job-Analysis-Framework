import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import { analyseWithRules } from '../server/jd';
import { seedDemo } from '../server/seed';
import { QUESTIONNAIRE } from '../shared/questionnaire';

process.env.JD_ANALYZER = 'rules';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const db = openDb(':memory:');
  seedDemo(db);
  app = createApp(db);
});

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: 'demo1234' }).expect(200);
  return agent;
}

describe('roles and visibility', () => {
  it('rejects anonymous access', async () => {
    await request(app).get('/api/evaluations').expect(401);
  });

  it('evaluators only see their own evaluations; admin sees all', async () => {
    const admin = await login('admin@demo.com');
    const ev = await login('evaluator@demo.com');
    const all = (await admin.get('/api/evaluations').expect(200)).body;
    const mine = (await ev.get('/api/evaluations').expect(200)).body;
    expect(all.length).toBe(33);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.every((e: { evaluator: { name: string } }) => e.evaluator.name === 'Sara Ahmed')).toBe(true);
  });

  it('evaluators cannot assign or edit grades', async () => {
    const ev = await login('evaluator@demo.com');
    await ev.post('/api/evaluations').send({ positionIds: [1], evaluatorId: 3 }).expect(403);
    await ev.post('/api/grade-structures').send({ name: 'X' }).expect(403);
  });

  it('organisations are isolated', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/register').send({ organization: 'Other Co', name: 'Owner', email: 'o@x.com', password: 'password1' }).expect(201);
    expect((await other.get('/api/evaluations').expect(200)).body).toEqual([]);
    await other.get('/api/evaluations/1').expect(404);
  });
});

describe('demo organisation', () => {
  it('has a worked example of every scenario', async () => {
    const mg = await login('management@demo.com');
    const evals = (await mg.get('/api/evaluations')).body as { status: string; method: string; source: string; adjustedInputs: unknown }[];
    expect(new Set(evals.map((e) => e.status))).toEqual(new Set(['assigned', 'in_progress', 'submitted', 'returned', 'approved']));
    expect(evals.some((e) => e.status === 'submitted' && e.adjustedInputs)).toBe(true); // adjusted, awaiting approval
    expect(evals.some((e) => e.status === 'approved' && e.adjustedInputs)).toBe(true);
    expect(evals.some((e) => e.method === 'questionnaire' && e.status === 'submitted')).toBe(true);
    expect(evals.some((e) => e.source === 'jd_analysis')).toBe(true);

    const jobs = (await mg.get('/api/jobs')).body as { position: { code: string }; mode: string; basis: string; completeCount: number; evaluationCount: number }[];
    const job = (code: string) => jobs.find((j) => j.position.code === code)!;
    expect(job('FIN-15')).toMatchObject({ mode: 'multi', basis: 'consensus' });
    expect(job('HR-09')).toMatchObject({ mode: 'multi', basis: 'adjusted_consensus' });
    expect(job('OPS-20')).toMatchObject({ mode: 'multi', basis: 'calibrated' });
    expect(job('SAL-10')).toMatchObject({ mode: 'multi', completeCount: 2, evaluationCount: 3 });

    const { structures } = (await mg.get('/api/grade-structures')).body as { structures: { name: string }[] };
    expect(structures.map((x) => x.name).sort()).toEqual(['Acme Retail (Sindh)', 'Acme Services', 'Blue collar', 'Managers & leaders', 'Standard']);
    expect((await mg.get('/api/jd/analyses')).body.length).toBeGreaterThanOrEqual(4);

    // evaluators see the calibrated result of an approved multi-rater job
    const zainab = await login('evaluator3@demo.com');
    const plant = (await zainab.get('/api/evaluations')).body.find((e: { position: { code: string } }) => e.position.code === 'OPS-20');
    expect(plant.calibrated.inputs.psChallenge).toBe('4');

    // every respondent account has a questionnaire to look at
    for (const email of ['kamran@demo.com', 'hina@demo.com', 'farah@demo.com', 'usman@demo.com', 'tariq@demo.com']) {
      expect((await (await login(email)).get('/api/questionnaire-responses/mine')).body.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluation workflow', () => {
  it('assign → fill → submit → adjust → approve, with history', async () => {
    const admin = await login('admin@demo.com');
    const ev = await login('evaluator@demo.com');
    const mg = await login('management@demo.com');

    const d = (await admin.get('/api/departments')).body[0];
    const pos = (await admin.post('/api/positions').send({ code: 'NEW-1', title: 'New Role', companyId: d.companyId, departmentId: d.id }).expect(201)).body;
    const { ids } = (await admin.post('/api/evaluations').send({ positionIds: [pos.id], evaluatorId: 3 }).expect(201)).body;
    const id = ids[0];

    await ev.post(`/api/evaluations/${id}/submit`).expect(400); // incomplete
    const inputs = { khTechnical: 'F', khBreadth: 'II', khHumanRelations: '2', khShade: '', psEnvironment: 'E', psChallenge: '4', psPick: 'Low', acFreedom: 'E', acMagnitude: '3', acImpact: 'C', acShade: '' };
    const saved = (await ev.put(`/api/evaluations/${id}/inputs`).send({ inputs }).expect(200)).body;
    expect(saved.status).toBe('in_progress');
    expect(saved.result.totalPoints).toBe(1194);

    await mg.put(`/api/evaluations/${id}/adjust`).send({ inputs }).expect(409); // not yet submitted
    await ev.post(`/api/evaluations/${id}/submit`).expect(200);
    await ev.put(`/api/evaluations/${id}/inputs`).send({ inputs }).expect(409); // locked

    const adjusted = (await mg.put(`/api/evaluations/${id}/adjust`).send({ inputs: { ...inputs, acImpact: 'P' }, comment: 'Owns the IT budget' }).expect(200)).body;
    expect(adjusted.originalResult.totalPoints).toBe(1194);
    expect(adjusted.result.totalPoints).toBeGreaterThan(1194);

    const approved = (await mg.post(`/api/evaluations/${id}/approve`).send({}).expect(200)).body;
    expect(approved.status).toBe('approved');
    const detail = (await admin.get(`/api/evaluations/${id}`)).body;
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['assigned', 'started', 'submitted', 'adjusted', 'approved']);
  });

  it('management can return an evaluation for rework', async () => {
    const mg = await login('management@demo.com');
    const list = (await mg.get('/api/evaluations')).body;
    const sub = list.find((e: { status: string }) => e.status === 'submitted');
    await mg.post(`/api/evaluations/${sub.id}/return`).send({ comment: '' }).expect(400);
    const r = (await mg.post(`/api/evaluations/${sub.id}/return`).send({ comment: 'Check magnitude' }).expect(200)).body;
    expect(r.status).toBe('returned');
  });
});

describe('grade structures', () => {
  type Ev = { position: { code: string }; result: { grade: number; careerLevel: string }; gradeStructure: { name: string; source: string } };
  const find = (list: Ev[], code: string) => list.find((e) => e.position.code === code)!;

  it('grades each job with its own structure: position, then company default, then organisation default', async () => {
    const mg = await login('management@demo.com');
    const list = (await mg.get('/api/evaluations')).body as Ev[];
    expect(find(list, 'FIN-10').gradeStructure).toEqual(expect.objectContaining({ name: 'Standard', source: 'organisation' }));
    expect(find(list, 'FIN-10').result.grade).toBe(15);
    expect(find(list, 'OPS-05').gradeStructure).toEqual(expect.objectContaining({ name: 'Blue collar', source: 'position' }));
    expect(find(list, 'IT-04').gradeStructure).toEqual(expect.objectContaining({ name: 'Acme Services', source: 'company' }));
    // a position assignment beats the company default
    expect(find(list, 'ADM-01').gradeStructure).toEqual(expect.objectContaining({ name: 'Blue collar', source: 'position' }));
    expect(find(list, 'IT-04').result.careerLevel).toBe('Senior professional'); // 485 pts in Acme Services bands
  });

  it('editing one structure re-grades only the jobs that use it', async () => {
    const mg = await login('management@demo.com');
    const { structures } = (await mg.get('/api/grade-structures')).body;
    const standard = structures.find((x: { name: string }) => x.name === 'Standard');
    expect(standard.isDefault).toBe(true);
    const before = (await mg.get('/api/evaluations')).body as Ev[];
    await mg
      .put(`/api/grade-structures/${standard.id}/bands`)
      .send([
        { grade: 1, minPoints: 0, careerLevel: 'Junior', typicalRoles: '' },
        { grade: 2, minPoints: 500, careerLevel: 'Middle', typicalRoles: '' },
        { grade: 3, minPoints: 1000, careerLevel: 'Senior', typicalRoles: '' },
      ])
      .expect(200);
    const after = (await mg.get('/api/evaluations')).body as Ev[];
    expect(find(after, 'FIN-10').result.grade).toBe(3);
    expect(find(after, 'IT-04').result.grade).toBe(find(before, 'IT-04').result.grade);
  });

  it('creates, copies, assigns to positions and companies, sets the default and deletes', async () => {
    const mg = await login('management@demo.com');
    const admin = await login('admin@demo.com');
    const { structures } = (await mg.get('/api/grade-structures')).body;
    const standard = structures.find((x: { name: string }) => x.name === 'Standard');
    const { id } = (await mg.post('/api/grade-structures').send({ name: 'Managers', copyFrom: standard.id }).expect(201)).body;
    await mg.post('/api/grade-structures').send({ name: 'Managers' }).expect(409);

    const positions = (await admin.get('/api/positions')).body as { id: number; code: string; companyId: number; gradeStructure: { name: string } }[];
    const fin10 = positions.find((p) => p.code === 'FIN-10')!;
    await mg.post('/api/grade-structures/assign').send({ positionIds: [fin10.id], structureId: id }).expect(200);
    let p = (await admin.get('/api/positions')).body.find((x: { code: string }) => x.code === 'FIN-10');
    expect(p.gradeStructure).toEqual({ id, name: 'Managers', source: 'position' });

    // company default
    await mg.put(`/api/grade-structures/${id}/companies`).send({ companyIds: [fin10.companyId] }).expect(200);
    await mg.post('/api/grade-structures/assign').send({ positionIds: [fin10.id], structureId: null }).expect(200);
    p = (await admin.get('/api/positions')).body.find((x: { code: string }) => x.code === 'FIN-10');
    expect(p.gradeStructure.source).toBe('company');

    // the default cannot be deleted; deleting another falls back
    await mg.delete(`/api/grade-structures/${standard.id}`).expect(409);
    await mg.patch(`/api/grade-structures/${id}`).send({ isDefault: true }).expect(200);
    await mg.delete(`/api/grade-structures/${standard.id}`).expect(200);
    const list = (await mg.get('/api/grade-structures')).body.structures;
    expect(list.find((x: { id: number }) => x.id === id).isDefault).toBe(true);
    expect(list.some((x: { name: string }) => x.name === 'Standard')).toBe(false);
  });

  it('rejects non-ascending bands and unknown structures', async () => {
    const admin = await login('admin@demo.com');
    const { structures } = (await admin.get('/api/grade-structures')).body;
    await admin
      .put(`/api/grade-structures/${structures[0].id}/bands`)
      .send([
        { grade: 1, minPoints: 0, careerLevel: '', typicalRoles: '' },
        { grade: 2, minPoints: 0, careerLevel: '', typicalRoles: '' },
      ])
      .expect(400);
    await admin.post('/api/grade-structures/assign').send({ positionIds: [1], structureId: 99999 }).expect(404);
    await admin
      .post('/api/positions/import')
      .send([{ code: 'Z-1', title: 'Z', company: 'Acme Services', department: 'Sales', gradeStructure: 'Nope' }])
      .expect(400);
  });

  it('keeps grade structures separate between organisations', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/register').send({ organization: 'Other Co', name: 'Owner', email: 'o2@x.com', password: 'password1' }).expect(201);
    const theirs = (await other.get('/api/grade-structures')).body.structures;
    expect(theirs.map((x: { name: string }) => x.name)).toEqual(['Standard']);
    const mg = await login('management@demo.com');
    const ours = (await mg.get('/api/grade-structures')).body.structures;
    await other.put(`/api/grade-structures/${ours[1].id}/bands`).send([{ grade: 1, minPoints: 0, careerLevel: '', typicalRoles: '' }, { grade: 2, minPoints: 5, careerLevel: '', typicalRoles: '' }]).expect(404);
  });
});

describe('job description analysis', () => {
  it('rule-based analyser gives sensible relative levels', () => {
    const clerk = analyseWithRules('Data Entry Clerk', 'Enters invoices into the system following standard operating procedures. Work is checked under close supervision.');
    const director = analyseWithRules('Finance Director', 'Reports to the CEO. Sets financial strategy, leads a team of 40 across accounting, treasury and tax, and is accountable for a $250 million budget. Chartered accountant with 15 years experience.');
    const L = 'ABCDEFGH';
    expect(L.indexOf(director.inputs.khTechnical)).toBeGreaterThan(L.indexOf(clerk.inputs.khTechnical));
    expect(director.inputs.acMagnitude).toBe('4');
    expect(director.inputs.acImpact).toBe('P');
  });

  it('analyse endpoint scores and stores; management can commit it as an evaluation', async () => {
    const mg = await login('management@demo.com');
    const res = (
      await mg.post('/api/jd/analyze').send({ title: 'Procurement Manager', text: 'Manages a team of 6 buyers, negotiates supplier contracts and is accountable for $30M annual spend. Degree and 8 years experience.' }).expect(200)
    ).body;
    expect(res.analysis.method).toBe('rules');
    expect(res.result.complete).toBe(true);
    const depts = (await mg.get('/api/departments')).body;
    const d = depts[0];
    const { evaluationId } = (
      await mg.post(`/api/jd/analyses/${res.id}/commit`).send({ newPosition: { code: 'PRC-10', title: 'Procurement Manager', companyId: d.companyId, departmentId: d.id } }).expect(201)
    ).body;
    const e = (await mg.get(`/api/evaluations/${evaluationId}`).expect(200)).body;
    expect(e.status).toBe('submitted');
    expect(e.source).toBe('jd_analysis');
    expect(e.result.totalPoints).toBe(res.result.totalPoints);
  });
});

describe('multi-evaluator calibration', () => {
  const base = { khShade: '', psPick: 'Low', acShade: '' };
  const A = { ...base, khTechnical: 'F', khBreadth: 'II', khHumanRelations: '2', psEnvironment: 'E', psChallenge: '4', acFreedom: 'E', acMagnitude: '3', acImpact: 'C' };
  const B = { ...A, acImpact: 'P', khTechnical: 'E' };
  const C = { ...A, khTechnical: 'E', acMagnitude: '2' };

  async function setup() {
    const admin = await login('admin@demo.com');
    const d = (await admin.get('/api/departments')).body[0];
    const pos = (await admin.post('/api/positions').send({ code: 'CAL-1', title: 'Calibrated Role', companyId: d.companyId, departmentId: d.id }).expect(201)).body;
    const users = (await admin.get('/api/users')).body as { id: number; email: string }[];
    const e1 = users.find((u) => u.email === 'evaluator@demo.com')!.id;
    const e2 = users.find((u) => u.email === 'evaluator2@demo.com')!.id;
    await admin.post('/api/users').send({ name: 'Third Rater', email: 'ev3@demo.com', role: 'evaluator', password: 'demo1234' }).expect(201);
    const e3 = (await admin.get('/api/users')).body.find((u: { email: string }) => u.email === 'ev3@demo.com').id;
    const res = (await admin.post('/api/evaluations').send({ positionIds: [pos.id], evaluatorIds: [e1, e2, e3] }).expect(201)).body;
    expect(res.ids).toHaveLength(3);
    // assigning the same evaluator again is skipped
    const again = (await admin.post('/api/evaluations').send({ positionIds: [pos.id], evaluatorIds: [e1] }).expect(201)).body;
    expect(again.ids).toHaveLength(0);
    expect(again.skipped).toHaveLength(1);
    return { admin, posId: pos.id as number };
  }

  async function rate(email: string, posId: number, inputs: object) {
    const a = await login(email);
    const mine = (await a.get('/api/evaluations')).body.find((e: { position: { id: number } }) => e.position.id === posId);
    await a.put(`/api/evaluations/${mine.id}/inputs`).send({ inputs }).expect(200);
    await a.post(`/api/evaluations/${mine.id}/submit`).expect(200);
    return { agent: a, id: mine.id as number };
  }

  it('evaluators are blind to each other and to the evaluator count', async () => {
    const { posId } = await setup();
    const { agent, id } = await rate('evaluator@demo.com', posId, A);
    const mine = (await agent.get('/api/evaluations')).body.filter((e: { position: { id: number } }) => e.position.id === posId);
    expect(mine).toHaveLength(1);
    expect(mine[0].raterCount).toBeUndefined();
    expect((await agent.get(`/api/evaluations/${id}`)).body.raterCount).toBeUndefined();
    const other = await login('evaluator2@demo.com');
    await other.get(`/api/evaluations/${id}`).expect(404);
    await agent.get(`/api/jobs/${posId}`).expect(403);
    await agent.get('/api/jobs').expect(403);
  });

  it('builds a most-common-level consensus, lets management adjust, approve and reopen', async () => {
    const { admin, posId } = await setup();
    const mg = await login('management@demo.com');
    await rate('evaluator@demo.com', posId, A);
    let job = (await mg.get(`/api/jobs/${posId}`)).body;
    expect(job.mode).toBe('multi');
    expect(job.status).toBe('in_progress');
    await mg.post(`/api/jobs/${posId}/calibration/approve`).send({}).expect(409); // others have not submitted yet

    const { id: id2 } = await rate('evaluator2@demo.com', posId, B);
    await rate('ev3@demo.com', posId, C);
    job = (await mg.get(`/api/jobs/${posId}`)).body;
    expect(job.status).toBe('submitted');
    expect(job.basis).toBe('consensus');
    expect(job.consensus.inputs.khTechnical).toBe('E'); // F, E, E
    expect(job.consensus.inputs.acMagnitude).toBe('3'); // 3, 3, 2
    expect(job.consensus.inputs.acImpact).toBe('C'); // C, P, C
    expect(job.consensus.elements.khTechnical.disagreement).toBe(true);
    expect(job.spread.minPoints).toBeLessThan(job.spread.maxPoints);

    // individual adjust/approve is routed to calibration
    await mg.put(`/api/evaluations/${id2}/adjust`).send({ inputs: B }).expect(409);
    await mg.post(`/api/evaluations/${id2}/approve`).send({}).expect(409);
    // admin can read but not calibrate
    await admin.get(`/api/jobs/${posId}`).expect(200);
    await admin.put(`/api/jobs/${posId}/calibration`).send({ inputs: null }).expect(403);

    const adjusted = { ...job.consensus.inputs, acImpact: 'P' };
    job = (await mg.put(`/api/jobs/${posId}/calibration`).send({ inputs: adjusted, comment: 'Owns the result' }).expect(200)).body;
    expect(job.basis).toBe('adjusted_consensus');
    const adjustedPoints = job.result.totalPoints;

    // before approval, evaluators see nothing of the calibration
    const ev2 = await login('evaluator2@demo.com');
    expect((await ev2.get(`/api/evaluations/${id2}`)).body.calibrated).toBeNull();

    job = (await mg.post(`/api/jobs/${posId}/calibration/approve`).send({}).expect(200)).body;
    expect(job.status).toBe('approved');

    // after approval, each evaluator sees the final calibrated result, still blind to the others
    const seen = (await ev2.get(`/api/evaluations/${id2}`)).body;
    expect(seen.calibrated.result.totalPoints).toBe(adjustedPoints);
    expect(seen.calibrated.inputs.acImpact).toBe('P');
    expect(seen.calibrated.comment).toBe('Owns the result');
    expect(seen.raterCount).toBeUndefined();
    expect(seen.history.every((h: { details: object }) => Object.keys(h.details).length === 0)).toBe(true);
    expect(JSON.stringify(seen)).not.toMatch(/Sara Ahmed|Third Rater/);
    const listed = (await ev2.get('/api/evaluations')).body.find((e: { id: number }) => e.id === id2);
    expect(listed.calibrated.result.grade).toBe(job.result.grade);
    expect(job.basis).toBe('calibrated');
    expect(job.result.totalPoints).toBe(adjustedPoints);
    expect(job.evaluations.every((e: { status: string }) => e.status === 'approved')).toBe(true);
    await mg.post(`/api/evaluations/${id2}/return`).send({ comment: 'x' }).expect(409);

    // dashboards count the job once
    const jobs = (await mg.get('/api/jobs')).body.filter((j: { id: number }) => j.id === posId);
    expect(jobs).toHaveLength(1);

    job = (await mg.post(`/api/jobs/${posId}/calibration/reopen`).send({}).expect(200)).body;
    expect(job.status).toBe('submitted');
    expect((await ev2.get(`/api/evaluations/${id2}`)).body.calibrated).toBeNull();
    expect(job.basis).toBe('adjusted_consensus');
    await mg.post(`/api/evaluations/${id2}/return`).send({ comment: 'Recheck impact' }).expect(200);
  });
});

describe('questionnaire pack: job holder & line manager panel', () => {
  const answerAll = (level: (el: string, i: number) => number, opts: { evaluator?: boolean } = {}) =>
    Object.fromEntries(
      QUESTIONNAIRE.flatMap((el) =>
        el.questions.filter((q) => opts.evaluator || !q.evaluatorOnly).map((q, i) => [q.id, Math.min(level(el.id, i), el.codes.length)] as const),
      ),
    );
  const evQuestionnaire = (answers: Record<string, number>, level: 'N' | '1' | '2' | '3' | '4' | '5' = '2') => ({
    answers,
    magnitude: { figures: [{ measure: 'Operating budget or cost base', usd: 8_000_000, local: '', influence: 'direct' }], primary: 0, level, source: 'FY budget' },
    overrides: {},
  });

  it('respondents only reach their own questionnaires', async () => {
    const lm = await login('kamran@demo.com');
    await lm.get('/api/evaluations').expect(403);
    await lm.get('/api/jobs').expect(403);
    await lm.get('/api/companies').expect(403);
    await lm.get('/api/grade-structures').expect(403);
    await lm.post('/api/jd/analyze').send({ text: 'x'.repeat(40) }).expect(403);
    const mine = (await lm.get('/api/questionnaire-responses/mine').expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ role: 'LM', status: 'submitted' });
    const jh = await login('hina@demo.com');
    await jh.get(`/api/questionnaire-responses/mine/${mine[0].id}`).expect(404);
  });

  it('the line manager never sees the job holder’s ratings, only their job information', async () => {
    const jh = await login('hina@demo.com');
    const [req] = (await jh.get('/api/questionnaire-responses/mine')).body;
    await jh
      .put(`/api/questionnaire-responses/mine/${req.id}`)
      .send({ answers: { ...answerAll(() => 7), 'PS_C.4': 5 }, jobInfo: { purpose: 'Run IT' }, complexProblem: 'ERP' })
      .expect(200);
    const saved = (await jh.get(`/api/questionnaire-responses/mine/${req.id}`)).body;
    expect(saved.answers['PS_C.4']).toBeUndefined(); // evaluator-only question dropped
    await jh.post(`/api/questionnaire-responses/mine/${req.id}/submit`).expect(200);
    await jh.put(`/api/questionnaire-responses/mine/${req.id}`).send({ answers: {} }).expect(409);

    const lm = await login('kamran@demo.com');
    const [lmReq] = (await lm.get('/api/questionnaire-responses/mine')).body;
    const view = (await lm.get(`/api/questionnaire-responses/mine/${lmReq.id}`)).body;
    expect(view.jobHolderInfo).toEqual([{ name: 'Hina Malik', jobInfo: { purpose: 'Run IT' }, complexProblem: 'ERP' }]);
    expect(JSON.stringify(view.jobHolderInfo)).not.toContain('KH_T');
  });

  it('evaluator questionnaire becomes the evaluation’s levels; the job holder is optional', async () => {
    const bilal = await login('evaluator2@demo.com');
    const e = (await bilal.get('/api/evaluations')).body.find((x: { position: { code: string } }) => x.position.code === 'IT-12');
    expect(e.method).toBe('questionnaire');
    let detail = (await bilal.get(`/api/evaluations/${e.id}`)).body;
    expect(detail.questionnaire.respondents.map((r: { role: string; status: string }) => `${r.role}:${r.status}`)).toEqual(['LM:submitted', 'JH:invited']);
    expect(detail.questionnaire.respondents.find((r: { role: string }) => r.role === 'JH').answers).toBeNull();

    // incomplete questionnaire cannot be submitted
    await bilal.put(`/api/evaluations/${e.id}/questionnaire`).send({ questionnaire: evQuestionnaire({ 'KH_T.1': 6 }) }).expect(200);
    await bilal.post(`/api/evaluations/${e.id}/submit`).expect(400);

    // EV answers everything one level below the LM on KH-T; with no JH, each question takes the EV value
    const ev = answerAll((el) => ({ KH_T: 5, KH_B: 3, KH_H: 2, PS_E: 6, PS_C: 4, AC_F: 6, AC_I: 4 })[el]!, { evaluator: true });
    detail = (await bilal.put(`/api/evaluations/${e.id}/questionnaire`).send({ questionnaire: evQuestionnaire(ev) }).expect(200)).body;
    expect(detail.questionnaire.result.complete).toBe(true);
    expect(detail.inputs).toMatchObject({ khTechnical: 'E', khBreadth: 'II', khHumanRelations: '2', psEnvironment: 'F', psChallenge: '4', acFreedom: 'F', acMagnitude: '2', acImpact: 'P' });
    expect(detail.result.complete).toBe(true);

    // the job holder submits later: KH-T becomes the median of JH 7, LM 6/5…, EV 5
    const jh = await login('hina@demo.com');
    const [req] = (await jh.get('/api/questionnaire-responses/mine')).body;
    await jh.put(`/api/questionnaire-responses/mine/${req.id}`).send({ answers: answerAll(() => 8) }).expect(200);
    await jh.post(`/api/questionnaire-responses/mine/${req.id}/submit`).expect(200);
    detail = (await bilal.get(`/api/evaluations/${e.id}`)).body;
    expect(detail.inputs.khTechnical).toBe('F'); // LM's 6s now break the JH 8 / EV 5 tie
    expect(detail.questionnaire.result.elements.KH_T.divergentQuestions.length).toBeGreaterThan(0); // JH 8 vs LM 6/5

    await bilal.post(`/api/evaluations/${e.id}/submit`).expect(200);
    // switching to direct entry is no longer possible once submitted
    await bilal.put(`/api/evaluations/${e.id}/questionnaire`).send({ questionnaire: evQuestionnaire(ev) }).expect(409);
  });

  it('admin invites respondents; only respondent users can be invited', async () => {
    const admin = await login('admin@demo.com');
    const positions = (await admin.get('/api/positions')).body as { id: number; code: string }[];
    const pos = positions.find((p) => p.code === 'FIN-05')!;
    const users = (await admin.get('/api/users')).body as { id: number; email: string }[];
    const hina = users.find((u) => u.email === 'hina@demo.com')!;
    const sara = users.find((u) => u.email === 'evaluator@demo.com')!;
    await admin.post('/api/questionnaire-responses').send({ positionId: pos.id, userId: sara.id, role: 'JH' }).expect(400);
    const { id } = (await admin.post('/api/questionnaire-responses').send({ positionId: pos.id, userId: hina.id, role: 'JH' }).expect(201)).body;
    await admin.post('/api/questionnaire-responses').send({ positionId: pos.id, userId: hina.id, role: 'JH' }).expect(409);
    const list = (await admin.get(`/api/questionnaire-responses?positionId=${pos.id}`)).body;
    expect(list).toEqual([expect.objectContaining({ id, role: 'JH', status: 'invited', userName: 'Hina Malik' })]);
    const ev = await login('evaluator@demo.com');
    await ev.post('/api/questionnaire-responses').send({ positionId: pos.id, userId: hina.id, role: 'LM' }).expect(403);
    await admin.delete(`/api/questionnaire-responses/${id}`).expect(200);
  });
});
