import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { type DB, openDb } from '../server/db';
import { seedDemo } from '../server/seed';
import { pendingEvaluators, questionnaireWaits } from '../server/workflow';
import { QUESTIONNAIRE } from '../shared/questionnaire';

/**
 * Order-of-work rules: an action is refused while an earlier step it depends on is incomplete.
 */
let app: ReturnType<typeof createApp>;
let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
  seedDemo(db);
  app = createApp(db);
});
async function login(email: string) {
  const a = request.agent(app);
  await a.post('/api/auth/login').send({ email, password: 'demo1234' }).expect(200);
  return a;
}
async function ctx() {
  const admin = await login('admin@demo.com');
  const evals = (await admin.get('/api/evaluations')).body as { id: number; status: string; position: { id: number; code: string }; evaluator: { name: string } | null }[];
  const users = (await admin.get('/api/users')).body as { id: number; email: string }[];
  const positions = (await admin.get('/api/positions')).body as { id: number; code: string }[];
  return {
    admin,
    ev: (code: string, name?: string) => evals.find((e) => e.position.code === code && (!name || e.evaluator?.name === name))!,
    uid: (email: string) => users.find((u) => u.email === email)!.id,
    pos: (code: string) => positions.find((p) => p.code === code)!.id,
  };
}
const evAnswers = Object.fromEntries(QUESTIONNAIRE.flatMap((el) => el.questions.map((q) => [q.id, Math.min(3, el.codes.length)])));
const evQ = { answers: evAnswers, magnitude: { figures: [], primary: null, level: '2', source: 'budget' }, overrides: {} };
const INPUTS = { khTechnical: 'E', khBreadth: 'I', khHumanRelations: '3', khShade: '', psEnvironment: 'E', psChallenge: '3', psPick: 'Low', acFreedom: 'E', acMagnitude: '3', acImpact: 'C', acShade: '' };

describe('the demo data follows the rules', () => {
  it('has no submitted questionnaire evaluation with missing answers and no calibration ahead of its evaluators', () => {
    const qs = db.prepare("SELECT position_id FROM evaluations WHERE method = 'questionnaire' AND status IN ('submitted','approved')").all() as { position_id: number }[];
    for (const q of qs) expect(questionnaireWaits(db, q.position_id)).toEqual([]);
    const cals = db.prepare("SELECT position_id FROM calibrations WHERE status = 'approved' OR adjusted_inputs IS NOT NULL").all() as { position_id: number }[];
    for (const c of cals) expect(pendingEvaluators(db, c.position_id)).toEqual([]);
  });
});

describe('questionnaire evaluations wait for the line manager and job holders', () => {
  it('cannot be submitted before the line manager submits (QA-10), nor with no line manager asked (RET-12)', async () => {
    const { ev } = await ctx();
    const zainab = await login('evaluator3@demo.com');
    for (const code of ['QA-10', 'RET-12']) {
      const e = ev(code);
      const saved = (await zainab.put(`/api/evaluations/${e.id}/questionnaire`).send({ questionnaire: evQ }).expect(200)).body;
      expect(saved.questionnaire.waits.length).toBeGreaterThan(0);
      const r = await zainab.post(`/api/evaluations/${e.id}/submit`).expect(409);
      expect(r.body.error).toMatch(/line manager/);
    }
  });

  it('waits for an invited job holder until they answer or the request is withdrawn (IT-12)', async () => {
    const { admin, ev, pos } = await ctx();
    const bilal = await login('evaluator2@demo.com');
    const e = ev('IT-12');
    await bilal.put(`/api/evaluations/${e.id}/questionnaire`).send({ questionnaire: evQ }).expect(200);
    expect((await bilal.post(`/api/evaluations/${e.id}/submit`).expect(409)).body.error).toMatch(/Hina Malik/);
    const jh = (await admin.get(`/api/questionnaire-responses?positionId=${pos('IT-12')}`)).body.find((r: { role: string }) => r.role === 'JH');
    await admin.delete(`/api/questionnaire-responses/${jh.id}`).expect(200); // a pending request can be withdrawn
    await bilal.post(`/api/evaluations/${e.id}/submit`).expect(200);
  });

  it('keeps to the method the administrator assigned', async () => {
    const { admin, ev } = await ctx();
    const sara = await login('evaluator@demo.com');
    const e = ev('SAL-06'); // questionnaire
    await sara.put(`/api/evaluations/${e.id}/inputs`).send({ inputs: INPUTS }).expect(409);
    await sara.put(`/api/evaluations/${ev('OPS-15').id}/questionnaire`).send({ questionnaire: evQ }).expect(404); // not hers
    await admin.patch(`/api/evaluations/${e.id}/assignment`).send({ method: 'direct' }).expect(200);
    await sara.put(`/api/evaluations/${e.id}/inputs`).send({ inputs: INPUTS }).expect(200);
    await sara.put(`/api/evaluations/${e.id}/questionnaire`).send({ questionnaire: evQ }).expect(409);
    // submitted evaluations cannot change method or evaluator
    await admin.patch(`/api/evaluations/${ev('OPS-05').id}/assignment`).send({ method: 'questionnaire' }).expect(409);
  });

  it('fixes the respondents once a questionnaire evaluation of the job is submitted (IT-07)', async () => {
    const { admin, pos, uid } = await ctx();
    const reqs = (await admin.get(`/api/questionnaire-responses?positionId=${pos('IT-07')}`)).body;
    const lm = reqs.find((r: { role: string }) => r.role === 'LM');
    const jh = reqs.find((r: { role: string }) => r.role === 'JH');
    expect((await admin.post(`/api/questionnaire-responses/${lm.id}/reopen`).expect(409)).body.error).toMatch(/return it/);
    await admin.delete(`/api/questionnaire-responses/${jh.id}`).expect(409);
    await admin.post('/api/questionnaire-responses').send({ positionId: pos('IT-07'), userId: uid('hina@demo.com'), role: 'JH' }).expect(400);
    // once management returns the evaluation, the respondents can change again
    const mg = await login('management@demo.com');
    const e = (await mg.get('/api/evaluations')).body.find((x: { position: { code: string } }) => x.position.code === 'IT-07');
    await mg.post(`/api/evaluations/${e.id}/return`).send({ comment: 'Check AC' }).expect(200);
    await admin.post(`/api/questionnaire-responses/${lm.id}/reopen`).expect(200);
  });
});

describe('calibration waits for every evaluator', () => {
  it('cannot adjust or approve while an evaluator has not submitted (SAL-10)', async () => {
    const { ev, pos } = await ctx();
    const mg = await login('management@demo.com');
    const id = pos('SAL-10');
    expect((await mg.put(`/api/jobs/${id}/calibration`).send({ inputs: INPUTS, comment: '' }).expect(409)).body.error).toMatch(/Zainab Hussain/);
    await mg.post(`/api/jobs/${id}/calibration/approve`).send({}).expect(409);
    await mg.put(`/api/jobs/${id}/calibration`).send({ inputs: null, comment: 'note' }).expect(200); // a note / revert is fine
    const zainab = await login('evaluator3@demo.com');
    const e = ev('SAL-10', 'Zainab Hussain');
    await zainab.put(`/api/evaluations/${e.id}/inputs`).send({ inputs: INPUTS }).expect(200);
    await zainab.post(`/api/evaluations/${e.id}/submit`).expect(200);
    await mg.post(`/api/jobs/${id}/calibration/approve`).send({}).expect(200);
  });

  it('protects an approved calibration (OPS-20)', async () => {
    const { admin, ev, pos } = await ctx();
    const id = pos('OPS-20');
    await admin.post('/api/users').send({ name: 'Fourth Rater', email: 'ev4@demo.com', role: 'evaluator', password: 'demo12345' }).expect(201);
    const ev4 = (await admin.get('/api/users')).body.find((u: { email: string }) => u.email === 'ev4@demo.com').id;
    const r = (await admin.post('/api/evaluations').send({ positionIds: [id], evaluatorIds: [ev4] }).expect(201)).body;
    expect(r.ids).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/calibration is approved/);
    await admin.delete(`/api/evaluations/${ev('OPS-20', 'Sara Ahmed').id}`).expect(409);
    const mg = await login('management@demo.com');
    const an = (await mg.post('/api/jd/analyze').send({ title: 'Plant Manager', text: 'Integrates production, maintenance and logistics; accountable for $60M cost.' })).body;
    await mg.post(`/api/jd/analyses/${an.id}/commit`).send({ positionId: id }).expect(409);
    // after reopening, a new evaluator can be added
    await mg.post(`/api/jobs/${id}/calibration/reopen`).expect(200);
    expect((await admin.post('/api/evaluations').send({ positionIds: [id], evaluatorIds: [ev4] }).expect(201)).body.ids).toHaveLength(1);
  });
});

describe('approved and finished work stays put', () => {
  it('adds no evaluator to a job whose single evaluation is approved, and reassigns only open evaluations', async () => {
    const { admin, ev, pos, uid } = await ctx();
    const r = (await admin.post('/api/evaluations').send({ positionIds: [pos('FIN-01')], evaluatorIds: [uid('evaluator3@demo.com')] }).expect(201)).body;
    expect(r.skipped[0].reason).toMatch(/approved/);
    await admin.patch(`/api/evaluations/${ev('OPS-05').id}/assignment`).send({ evaluatorId: uid('evaluator3@demo.com') }).expect(409);
  });

  it('changing an approved evaluation’s levels takes it back to awaiting review', async () => {
    const { ev } = await ctx();
    const mg = await login('management@demo.com');
    const e = ev('FIN-10');
    const after = (await mg.put(`/api/evaluations/${e.id}/adjust`).send({ inputs: { ...INPUTS, khTechnical: 'F' }, comment: 'x' }).expect(200)).body;
    expect(after.status).toBe('submitted');
    expect(after.history ?? []).toBeDefined();
    await mg.post(`/api/evaluations/${e.id}/approve`).send({}).expect(200);
  });

  it('keeps people with open work active until it is reassigned or withdrawn', async () => {
    const { admin, uid } = await ctx();
    await admin.patch(`/api/users/${uid('evaluator3@demo.com')}`).send({ active: false }).expect(409);
    await admin.patch(`/api/users/${uid('evaluator3@demo.com')}`).send({ role: 'management' }).expect(409);
    await admin.patch(`/api/users/${uid('tariq@demo.com')}`).send({ active: false }).expect(409);
    await admin.patch(`/api/users/${uid('farah@demo.com')}`).send({ active: false }).expect(200); // her request is submitted
  });
});
