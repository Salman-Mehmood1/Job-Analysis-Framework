import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADES, generateGrades } from '../shared/engine';
import { computePay, coverageProblems, frameworkPayModel, generatePayBands, mround, payModelFor, placeSalary } from '../shared/pay';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import { seedDemo } from '../server/seed';

describe('pay engine (Grading & Rewards Framework workbook)', () => {
  const m = frameworkPayModel();
  const t = computePay(m, DEFAULT_GRADES);
  const band = (code: string) => t.bands.find((b) => b.code === code)!;

  it('rounds like Excel MROUND', () => {
    expect(mround(56000, 5000)).toBe(55000);
    expect(mround(47500, 5000)).toBe(50000);
    expect(mround(0, 5000)).toBe(0);
  });

  it('reproduces the salary bands sheet', () => {
    expect(t.problems).toEqual([]);
    const rows = t.bands.map((b) => [b.code, b.min, b.mid, b.max, b.ctcMonthly]);
    expect(rows).toEqual([
      ['B-1', 40000, 50000, 55000, 57087],
      ['B-2', 50000, 65000, 75000, 70493],
      ['B-3', 70000, 90000, 105000, 96837],
      ['B-4', 95000, 120000, 145000, 128449],
      ['B-5', 130000, 165000, 195000, 175867],
      ['B-6', 175000, 220000, 265000, 266823],
      ['B-7', 240000, 315000, 385000, 379929],
      ['B-8', 345000, 450000, 550000, 524184],
      ['B-9', 495000, 645000, 790000, 748664],
      ['B-10', 710000, 925000, 1135000, 1053711],
      ['B-11', 1020000, 1325000, 1630000, 1522208],
    ]);
    // B-1 anchor 36,000 is lifted to the Punjab minimum wage
    expect(band('B-1').belowMinimumWage).toBe(false);
    expect(band('B-11')).toMatchObject({ basic: 854839, houseRent: 384678, utilities: 85483, opdLimit: 855000, groupLife: 31800000 });
    expect(band('B-11').cadreResult).toMatchObject({ carAllowance: 124000, fuelRatePerKm: 39.83, hotelNonUtilisationPerDay: 7000, foodOutstationPerDay: 5000 });
    expect(band('B-1').employer).toEqual({ pf: 2687, gratuity: 0, eobi: 2000, socialSecurity: 2400, bonus: 0 });
    expect(band('B-1').opdLimit).toBeNull();
  });

  it('splits multi-grade bands into grade zones', () => {
    expect(t.zones.find((z) => z.grade === 6)).toMatchObject({ band: 'B-2', zoneMin: 50000, zoneRef: 57000, zoneMax: 63000 });
    expect(t.zones.find((z) => z.grade === 23)).toMatchObject({ band: 'B-11', zoneMin: 1427000, zoneRef: 1529000, zoneMax: 1630000 });
    expect(t.zones.find((z) => z.grade === 10)).toMatchObject({ zoneMin: 95000, zoneMax: 145000 });
  });

  it('places a salary like the Placement & CTC sheet', () => {
    const r = placeSalary(t, m, 6, 62000, { pfMember: false })!;
    expect(r.position).toBe('In zone');
    expect(r.compaRatio).toBeCloseTo(0.9538, 3);
    expect(r.rangePenetration).toBeCloseTo(0.48, 3);
    expect(r.ctcMonthly).toBe(64000);
    expect(placeSalary(t, m, 6, 39000)!.position).toBe('Below minimum wage');
    expect(placeSalary(t, m, 6, 70000)!.position).toBe('In band, above zone');
  });

  it('responds to the inputs: minimum wage, lift, overlap and spreads', () => {
    const sindh = computePay({ ...m, region: 'Sindh' }, DEFAULT_GRADES);
    expect(sindh.bands[0].min).toBe(45000); // 43,000 rounded up to 5,000
    const noLift = computePay({ ...m, region: 'Sindh', liftToMinimumWage: false }, DEFAULT_GRADES);
    expect(noLift.bands[0]).toMatchObject({ min: 36000, belowMinimumWage: true });
    const tight = computePay({ ...m, overlap: 0 }, DEFAULT_GRADES);
    expect(tight.bands[1].min).toBe(t.bands[0].max);
    const wide = computePay({ ...m, tiers: m.tiers.map((x) => ({ ...x, spread: 1 })) }, DEFAULT_GRADES);
    expect(wide.bands[0].max).toBe(80000);
  });

  it('generates bands for any grade structure and checks coverage', () => {
    const grades = generateGrades(10, 100, 1500);
    const bands = generatePayBands(grades, 4);
    expect(bands.map((b) => [b.gradeFrom, b.gradeTo])).toEqual([[1, 3], [4, 6], [7, 8], [9, 10]]);
    expect(bands[0].tier).toBe('Junior');
    expect(bands[3].tier).toBe('Senior');
    const model = payModelFor(grades, 4);
    expect(computePay(model, grades).problems).toEqual([]);
    expect(coverageProblems({ ...model, bands: model.bands.slice(1) }, grades)[0]).toMatch(/must start at grade 1/);
    expect(coverageProblems(model, generateGrades(12, 100, 1500))[0]).toMatch(/top grade/);
  });
});

describe('pay API', () => {
  async function setup() {
    const db = openDb(':memory:');
    seedDemo(db);
    const app = createApp(db);
    const login = async (email: string) => {
      const a = request.agent(app);
      await a.post('/api/auth/login').send({ email, password: 'demo1234' }).expect(200);
      return a;
    };
    return { login };
  }

  it('demo structures carry salary bands built from different inputs', async () => {
    const { login } = await setup();
    const mg = await login('management@demo.com');
    const { structures } = (await mg.get('/api/grade-structures')).body as { structures: { name: string; pay: { region: string; bands: unknown[] }; payTable: { problems: string[]; bands: { belowMinimumWage: boolean }[] } }[] };
    const by = (n: string) => structures.find((s) => s.name === n)!;
    expect(by('Standard').pay.bands).toHaveLength(11);
    expect(by('Blue collar').pay.bands).toHaveLength(3);
    expect(by('Managers & leaders').pay.bands).toHaveLength(6);
    expect(by('Acme Services').pay.region).toBe('Islamabad (ICT)');
    expect(by('Acme Retail (Sindh)').payTable.bands[0].belowMinimumWage).toBe(true);
    for (const s of structures) expect(s.payTable.problems).toEqual([]);

    // jobs carry their band and pay zone
    const jobs = (await mg.get('/api/jobs')).body as { position: { code: string }; pay: { band: string; cadre: string; zoneMin: number } | null }[];
    expect(jobs.find((j) => j.position.code === 'FIN-01')!.pay).toMatchObject({ band: 'B-2', cadre: 'Officer', zoneMin: 50000 });
  });

  it('evaluators never see pay', async () => {
    const { login } = await setup();
    const ev = await login('evaluator@demo.com');
    const { structures } = (await ev.get('/api/grade-structures')).body;
    expect(structures.every((s: { pay: unknown; payTable: unknown }) => s.pay === null && s.payTable === null)).toBe(true);
    const mine = (await ev.get('/api/evaluations')).body;
    expect(mine.every((e: { pay?: unknown }) => e.pay === undefined)).toBe(true);
  });

  it('saves, validates and removes a structure’s salary bands; creates a structure with pay', async () => {
    const { login } = await setup();
    const mg = await login('management@demo.com');
    const ev = await login('evaluator@demo.com');
    const { structures } = (await mg.get('/api/grade-structures')).body;
    const blue = structures.find((s: { name: string }) => s.name === 'Blue collar');

    const pay = { ...blue.pay, anchor: 50000 };
    const saved = (await mg.put(`/api/grade-structures/${blue.id}/pay`).send({ pay }).expect(200)).body;
    expect(saved.payTable.bands[0].min).toBe(50000);
    await mg.put(`/api/grade-structures/${blue.id}/pay`).send({ pay: { ...pay, bands: [{ ...pay.bands[0], cadre: 'Nobody' }] } }).expect(400);
    await ev.put(`/api/grade-structures/${blue.id}/pay`).send({ pay }).expect(403);
    await mg.put(`/api/grade-structures/${blue.id}/pay`).send({ pay: null }).expect(200);
    const jobs = (await mg.get('/api/jobs')).body as { position: { code: string }; pay: unknown }[];
    expect(jobs.find((j) => j.position.code === 'OPS-05')!.pay).toBeNull();

    // copying a structure copies its pay setup; a new structure can take another's
    const standard = structures.find((s: { name: string }) => s.name === 'Standard');
    const { id } = (await mg.post('/api/grade-structures').send({ name: 'Copy', copyFrom: standard.id }).expect(201)).body;
    const { id: id2 } = (await mg.post('/api/grade-structures').send({ name: 'Points only', copyFrom: standard.id, pay: null }).expect(201)).body;
    const after = (await mg.get('/api/grade-structures')).body.structures;
    expect(after.find((s: { id: number }) => s.id === id).pay.bands).toHaveLength(11);
    expect(after.find((s: { id: number }) => s.id === id2).pay).toBeNull();
  });
});
