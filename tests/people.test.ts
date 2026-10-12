import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import { seedDemo } from '../server/seed';
import { QUESTIONNAIRE } from '../shared/questionnaire';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const db = openDb(':memory:');
  seedDemo(db);
  app = createApp(db);
});
async function login(email: string, password = 'demo1234') {
  const a = request.agent(app);
  await a.post('/api/auth/login').send({ email, password }).expect(200);
  return a;
}
async function setup() {
  const admin = await login('admin@demo.com');
  const users = (await admin.get('/api/users')).body as { id: number; email: string }[];
  const uid = (email: string) => users.find((u) => u.email === email)!.id;
  const positions = (await admin.get('/api/positions')).body as { id: number; code: string; departmentId: number; companyId: number; lineManager: { id: number; name: string } | null; jobHolders: { id: number }[] }[];
  const pos = (code: string) => positions.find((p) => p.code === code)!;
  const newPosition = async (code: string) => {
    const d = pos('FIN-01');
    return (await admin.post('/api/positions').send({ code, title: `Role ${code}`, companyId: d.companyId, departmentId: d.departmentId }).expect(201)).body.id as number;
  };
  return { admin, uid, pos, newPosition };
}

describe('line managers and job holders', () => {
  it('positions carry their default line manager and job holders', async () => {
    const { pos } = await setup();
    expect(pos('IT-12').lineManager?.name).toBe('Kamran Ali');
    expect(pos('IT-07').jobHolders).toHaveLength(1);
    expect(pos('SAL-06').lineManager?.name).toBe('Bilal Raza');
  });

  it('assignment asks the chosen line manager and job holders, saves them as defaults and blocks conflicts', async () => {
    const { admin, uid, pos, newPosition } = await setup();
    const pid = await newPosition('NEW-1');
    const omar = uid('management@demo.com');
    const hina = uid('hina@demo.com');
    const sara = uid('evaluator@demo.com');
    const r = (
      await admin
        .post('/api/evaluations')
        .send({
          positionIds: [pid], evaluatorIds: [uid('evaluator2@demo.com'), sara], method: 'questionnaire',
          respondents: [{ positionId: pid, lineManagerId: omar, jobHolderIds: [hina, sara], askJobHolders: true }], saveAsDefaults: true,
        })
        .expect(201)
    ).body;
    // Sara is chosen as a job holder, so she is not assigned as an evaluator; Bilal is.
    expect(r.ids).toHaveLength(1);
    expect(r.skipped).toEqual([expect.objectContaining({ evaluatorId: sara, reason: expect.stringMatching(/job holder|questionnaire/) })]);
    expect(r.invited).toHaveLength(3);
    const list = (await admin.get(`/api/questionnaire-responses?positionId=${pid}`)).body;
    expect(list.map((x: { role: string; userName: string }) => `${x.role}:${x.userName}`).sort()).toEqual(['JH:Hina Malik', 'JH:Sara Ahmed', 'LM:Omar Siddiqui (Management)']);
    const p = (await admin.get('/api/positions')).body.find((x: { id: number }) => x.id === pid);
    expect(p.lineManager.id).toBe(omar);
    // Sara is now a job holder, so she cannot evaluate this job later either
    const again = (await admin.post('/api/evaluations').send({ positionIds: [pid], evaluatorIds: [sara], method: 'direct' }).expect(201)).body;
    expect(again.ids).toHaveLength(0);
    // nor be invited where she evaluates
    await admin.post('/api/questionnaire-responses').send({ positionId: pos('FIN-05').id, userId: sara, role: 'LM' }).expect(400);
    await admin.put(`/api/positions/${pos('FIN-05').id}/people`).send({ lineManagerId: sara, jobHolderIds: [] }).expect(400);
  });

  it('questionnaire assignments ask the position’s line manager; job holders only when asked for', async () => {
    const { admin, uid, newPosition } = await setup();
    const pid = await newPosition('NEW-2');
    await admin.put(`/api/positions/${pid}/people`).send({ lineManagerId: uid('kamran@demo.com'), jobHolderIds: [uid('usman@demo.com')] }).expect(200);
    const r = (await admin.post('/api/evaluations').send({ positionIds: [pid], evaluatorIds: [uid('evaluator3@demo.com')], method: 'questionnaire' }).expect(201)).body;
    expect(r.invited).toHaveLength(1);
    let list = (await admin.get(`/api/questionnaire-responses?positionId=${pid}`)).body;
    expect(list.map((x: { role: string }) => x.role)).toEqual(['LM']);
    // the job holder is a separate, optional step
    const jh = (await admin.post('/api/questionnaire-responses/invite-defaults').send({ positionIds: [pid], role: 'JH' }).expect(200)).body;
    expect(jh.invited).toBe(1);
    list = (await admin.get(`/api/questionnaire-responses?positionId=${pid}`)).body;
    expect(list.map((x: { role: string }) => x.role).sort()).toEqual(['JH', 'LM']);
    // a chosen job holder without askJobHolders is saved as default but not asked
    const pid3 = await newPosition('NEW-4');
    const r3 = (await admin.post('/api/evaluations').send({
      positionIds: [pid3], evaluatorIds: [uid('evaluator3@demo.com')], method: 'questionnaire', saveAsDefaults: true,
      respondents: [{ positionId: pid3, lineManagerId: uid('kamran@demo.com'), jobHolderIds: [uid('hina@demo.com')] }],
    }).expect(201)).body;
    expect(r3.invited).toHaveLength(1);
    expect((await admin.get('/api/positions')).body.find((p: { id: number }) => p.id === pid3).jobHolders).toHaveLength(1);
    // direct assignments do not ask anyone
    const pid2 = await newPosition('NEW-3');
    await admin.put(`/api/positions/${pid2}/people`).send({ lineManagerId: uid('kamran@demo.com'), jobHolderIds: [] }).expect(200);
    const d = (await admin.post('/api/evaluations').send({ positionIds: [pid2], evaluatorIds: [uid('evaluator3@demo.com')] }).expect(201)).body;
    expect(d.invited).toHaveLength(0);
  });

  it('switching an evaluation to the questionnaire asks the position’s line manager', async () => {
    const { admin, uid, newPosition } = await setup();
    const pid = await newPosition('NEW-5');
    await admin.put(`/api/positions/${pid}/people`).send({ lineManagerId: uid('farah@demo.com'), jobHolderIds: [uid('usman@demo.com')] }).expect(200);
    const { ids } = (await admin.post('/api/evaluations').send({ positionIds: [pid], evaluatorIds: [uid('evaluator3@demo.com')] }).expect(201)).body;
    expect((await admin.get(`/api/questionnaire-responses?positionId=${pid}`)).body).toHaveLength(0); // direct: nobody asked
    const r = (await admin.patch(`/api/evaluations/${ids[0]}/assignment`).send({ method: 'questionnaire' }).expect(200)).body;
    expect(r.method).toBe('questionnaire');
    expect(r.lineManager.asked).toBe('Farah Naveed');
    expect((await admin.get(`/api/questionnaire-responses?positionId=${pid}`)).body.map((x: { role: string }) => x.role)).toEqual(['LM']);
  });

  it('staff can answer as line manager from their own panel', async () => {
    const bilal = await login('evaluator2@demo.com');
    const mine = (await bilal.get('/api/questionnaire-responses/mine').expect(200)).body;
    expect(mine.map((m: { position: { code: string }; role: string }) => `${m.position.code}:${m.role}`)).toEqual(['SAL-06:LM']);
    const answers = Object.fromEntries(QUESTIONNAIRE.flatMap((el) => el.questions.filter((q) => !q.evaluatorOnly).map((q) => [q.id, 2])));
    await bilal.put(`/api/questionnaire-responses/mine/${mine[0].id}`).send({ answers }).expect(200);
    await bilal.post(`/api/questionnaire-responses/mine/${mine[0].id}/submit`).expect(200);
    // and the admin cannot make him an evaluator of the job he manages
    const { admin, uid, pos } = await setup();
    const sal06 = (await admin.get('/api/evaluations')).body.find((e: { position: { code: string } }) => e.position.code === 'SAL-06');
    await admin.patch(`/api/evaluations/${sal06.id}/assignment`).send({ evaluatorId: uid('evaluator2@demo.com') }).expect(400);
    expect(pos('SAL-06').lineManager?.id).toBe(uid('evaluator2@demo.com'));
  });

  it('import sets line managers and job holders, creating missing accounts', async () => {
    const { admin } = await setup();
    const r = (
      await admin
        .post('/api/positions/import')
        .send([
          { code: 'IMP-1', title: 'Imported', company: 'Acme Retail', department: 'Stores', lineManagerEmail: 'kamran@demo.com', jobHolderEmails: 'new1@x.com; usman@demo.com', jobHolderNames: 'New Person;' },
          { code: 'FIN-01', title: 'ignored', company: 'Acme Manufacturing', department: 'Finance', lineManagerEmail: 'farah@demo.com' },
        ])
        .expect(200)
    ).body;
    expect(r).toMatchObject({ created: 1, skipped: ['FIN-01'], peopleSet: 2 });
    expect(r.createdUsers).toEqual([expect.objectContaining({ name: 'New Person', email: 'new1@x.com' })]);
    await login('new1@x.com', r.createdUsers[0].password);
    const positions = (await admin.get('/api/positions')).body;
    const imp = positions.find((p: { code: string }) => p.code === 'IMP-1');
    expect(imp.lineManager.name).toBe('Kamran Ali');
    expect(imp.jobHolders.map((j: { name: string }) => j.name).sort()).toEqual(['New Person', 'Usman Tariq']);
    expect(positions.find((p: { code: string }) => p.code === 'FIN-01').lineManager.name).toBe('Farah Naveed');
    // unknown email without a name is rejected, nothing is imported
    await admin.post('/api/positions/import').send([{ code: 'IMP-2', title: 'X', company: 'Acme Retail', department: 'Stores', lineManagerEmail: 'nobody@x.com' }]).expect(400);
    expect((await admin.get('/api/positions')).body.some((p: { code: string }) => p.code === 'IMP-2')).toBe(false);
  });

  it('overview lists every request, overdue ones and jobs missing a line manager', async () => {
    const { admin, uid, pos } = await setup();
    const o = (await admin.get('/api/questionnaire-responses/overview').expect(200)).body;
    expect(o.requests.length).toBeGreaterThanOrEqual(6);
    const today = new Date().toISOString().slice(0, 10);
    const tariq = o.requests.find((r: { userName: string }) => r.userName === 'Tariq Javed');
    expect(tariq.dueDate < today && tariq.status !== 'submitted').toBe(true);
    expect(o.missing).toEqual([expect.objectContaining({ positionCode: 'RET-12', defaultLineManager: { id: uid('rehan@demo.com'), name: 'Rehan Qureshi' } })]);

    await admin.patch(`/api/questionnaire-responses/${tariq.id}`).send({ dueDate: '2099-01-01' }).expect(200);
    const r = (await admin.post('/api/questionnaire-responses/invite-defaults').send({ positionIds: [pos('RET-12').id, pos('FIN-01').id] }).expect(200)).body;
    expect(r).toMatchObject({ invited: 1, noDefaults: [pos('FIN-01').id] });
    expect((await admin.get('/api/questionnaire-responses/overview')).body.missing).toEqual([]);

    const mg = await login('management@demo.com');
    await mg.get('/api/questionnaire-responses/overview').expect(200);
    await mg.patch(`/api/questionnaire-responses/${tariq.id}`).send({ dueDate: null }).expect(403);
  });
});
