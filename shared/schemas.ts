import { z } from 'zod';
import {
  BREADTHS,
  CHALLENGES,
  HUMAN_RELATIONS,
  IMPACTS,
  LETTERS,
  MAGNITUDES,
  PS_PICKS,
  SHADES,
} from './engine';

const opt = <T extends readonly [string, ...string[]]>(vals: T) => z.union([z.enum(vals), z.literal('')]);

export const inputsSchema = z.object({
  khTechnical: opt(LETTERS),
  khBreadth: opt(BREADTHS),
  khHumanRelations: opt(HUMAN_RELATIONS),
  khShade: z.enum(SHADES),
  psEnvironment: opt(LETTERS),
  psChallenge: opt(CHALLENGES),
  psPick: z.enum(PS_PICKS),
  acFreedom: opt(LETTERS),
  acMagnitude: opt(MAGNITUDES),
  acImpact: opt(IMPACTS),
  acShade: z.enum(SHADES),
});

export const gradeBandSchema = z.object({
  grade: z.number().int().min(1),
  minPoints: z.number().int().min(0),
  careerLevel: z.string().max(120),
  typicalRoles: z.string().max(300),
});

export const gradeStructureSchema = z
  .array(gradeBandSchema)
  .min(2)
  .max(60)
  .superRefine((grades, ctx) => {
    const mins = grades.map((g) => g.minPoints);
    for (let i = 1; i < mins.length; i++) {
      if (mins[i] <= mins[i - 1]) {
        ctx.addIssue({ code: 'custom', message: `Grade ${grades[i].grade}: min points must be higher than the grade below` });
      }
    }
    const nums = grades.map((g) => g.grade);
    if (new Set(nums).size !== nums.length) ctx.addIssue({ code: 'custom', message: 'Grade numbers must be unique' });
  });

const money = z.number().min(0).max(1e12);
const share = z.number().min(0).max(5);
const text = (n = 300) => z.string().max(n);

export const payBandSchema = z.object({
  code: z.string().trim().min(1).max(20),
  cadre: z.string().trim().min(1).max(80),
  gradeFrom: z.number().int().min(1),
  gradeTo: z.number().int().min(1),
  tier: z.string().trim().min(1).max(40),
  overlapOverride: z.number().min(0).max(0.95).nullable(),
  rounding: z.number().int().min(0).max(1e9),
});

export const cadreSchema = z.object({
  name: z.string().trim().min(1).max(80),
  designations: text(2000),
  promotion: text(),
  qualification: text(),
  experience: text(),
  vehicleClass: text(80),
  toolsVehicle: text(),
  simRetail: text(),
  simAll: text(),
  floatingCash: text(),
  conveyance: z.enum(['Car', 'Motorcycle']),
  hotelCap: money,
  hotelNonUtilisation: z.number().min(0).max(1),
  mealRate: money,
  transport: text(500),
  ipdCover: money.nullable(),
  room: text(),
  opdMonths: z.number().min(0).max(24),
  lifeMultiple: z.number().min(0).max(240),
  socialSecurity: z.boolean(),
});

export const payModelSchema = z
  .object({
    currency: z.string().trim().min(1).max(10),
    minimumWages: z.array(z.object({ region: z.string().trim().min(1).max(80), amount: money, note: text(500) })).max(50),
    region: z.string().max(80),
    anchor: money,
    liftToMinimumWage: z.boolean(),
    overlap: z.number().min(0).max(0.95),
    tiers: z.array(z.object({ name: z.string().trim().min(1).max(40), spread: share })).min(1).max(20),
    houseRent: share,
    utilities: share,
    retirement: z.enum(['Provident Fund', 'Gratuity', 'Both', 'None']),
    pfRate: share,
    gratuityMonths: z.number().min(0).max(24),
    eobiEmployer: share,
    eobiEmployee: share,
    eobiBase: money.nullable(),
    socialSecurityRate: share,
    socialSecurityCap: money.nullable(),
    bonusMonths: z.number().min(0).max(24),
    carAllowanceRate: share,
    carAllowanceRounding: z.number().int().min(0).max(1e9),
    vehicles: z.array(z.object({ vehicleClass: z.string().trim().min(1).max(80), model: text(160), price: money })).max(50),
    fuelPrice: money,
    carKmPerLitre: z.number().min(0).max(1000),
    bikeKmPerLitre: z.number().min(0).max(1000),
    hotelRounding: z.number().int().min(0).max(1e9),
    mealsOutstation: z.number().min(0).max(10),
    mealsLocal: z.number().min(0).max(10),
    zoneRounding: z.number().int().min(0).max(1e9),
    bands: z.array(payBandSchema).min(1).max(60),
    cadres: z.array(cadreSchema).min(1).max(60),
  })
  .superRefine((m, ctx) => {
    const unique = (vals: string[], what: string) => {
      if (new Set(vals).size !== vals.length) ctx.addIssue({ code: 'custom', message: `${what} must be unique` });
    };
    unique(m.bands.map((b) => b.code), 'Band codes');
    unique(m.cadres.map((c) => c.name), 'Cadre names');
    unique(m.tiers.map((t) => t.name), 'Tier names');
    unique(m.vehicles.map((v) => v.vehicleClass), 'Vehicle classes');
    for (const b of m.bands) {
      if (!m.cadres.some((c) => c.name === b.cadre)) ctx.addIssue({ code: 'custom', message: `${b.code}: unknown cadre "${b.cadre}"` });
      if (!m.tiers.some((t) => t.name === b.tier)) ctx.addIssue({ code: 'custom', message: `${b.code}: unknown tier "${b.tier}"` });
      if (b.gradeTo < b.gradeFrom) ctx.addIssue({ code: 'custom', message: `${b.code}: "to" grade is below the "from" grade` });
    }
    for (const c of m.cadres) {
      if (c.vehicleClass && !m.vehicles.some((v) => v.vehicleClass === c.vehicleClass)) {
        ctx.addIssue({ code: 'custom', message: `${c.name}: unknown vehicle class "${c.vehicleClass}"` });
      }
    }
    if (m.minimumWages.length && !m.minimumWages.some((w) => w.region === m.region)) {
      ctx.addIssue({ code: 'custom', message: 'Choose the region whose minimum wage applies' });
    }
  });
