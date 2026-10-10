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
