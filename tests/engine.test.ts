import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRADES,
  EMPTY_INPUTS,
  type EvaluationInputs,
  evaluate,
  generateGrades,
  knowHowPoints,
} from '../shared/engine';

const row = (p: Partial<EvaluationInputs>): EvaluationInputs => ({ ...EMPTY_INPUTS, ...p });

describe('engine matches the workbook worked examples', () => {
  it('Accounts Assistant: 206 points, grade 6', () => {
    const r = evaluate(
      row({ khTechnical: 'C', khBreadth: 'I', khHumanRelations: '1', psEnvironment: 'C', psChallenge: '2', acFreedom: 'B', acMagnitude: '1', acImpact: 'C' }),
      DEFAULT_GRADES,
    );
    expect([r.khPoints, r.psPercent, r.psPoints, r.acPoints]).toEqual([152, 19, 25, 29]);
    expect(r.totalPoints).toBe(206);
    expect(r.grade).toBe(6);
    expect(r.profile).toBe('A1');
    expect(r.checks).toContain('Borderline grade'); // 206 < 205 * 1.03
  });

  it('Finance Manager: 1,194 points, grade 15', () => {
    const r = evaluate(
      row({ khTechnical: 'F', khBreadth: 'II', khHumanRelations: '2', psEnvironment: 'E', psChallenge: '4', acFreedom: 'E', acMagnitude: '3', acImpact: 'C' }),
      DEFAULT_GRADES,
    );
    expect(r.totalPoints).toBe(1194);
    expect(r.grade).toBe(15);
    expect(r.careerLevel).toBe('Senior manager');
  });

  it('Plant Manager: 1,564 points, grade 17', () => {
    const r = evaluate(
      row({ khTechnical: 'F', khBreadth: 'III', khHumanRelations: '2', psEnvironment: 'F', psChallenge: '3', acFreedom: 'F', acMagnitude: '3', acImpact: 'P' }),
      DEFAULT_GRADES,
    );
    expect(r.totalPoints).toBe(1564);
    expect(r.grade).toBe(17);
  });

  it('shading moves one step (E II 2 = 460, E+ = 528, E- = 400)', () => {
    const base = row({ khTechnical: 'E', khBreadth: 'II', khHumanRelations: '2' });
    expect(knowHowPoints(base)).toBe(460);
    expect(knowHowPoints({ ...base, khShade: '+' })).toBe(528);
    expect(knowHowPoints({ ...base, khShade: '-' })).toBe(400);
  });

  it('magnitude N ignores impact', () => {
    const r = evaluate(
      row({ khTechnical: 'A', khBreadth: 'T', khHumanRelations: '1', psEnvironment: 'A', psChallenge: '1', acFreedom: 'A', acMagnitude: 'N' }),
      DEFAULT_GRADES,
    );
    expect(r.acPoints).toBe(14);
    expect(r.complete).toBe(true);
  });

  it('incomplete inputs give no total', () => {
    const r = evaluate(row({ khTechnical: 'C' }), DEFAULT_GRADES);
    expect(r.complete).toBe(false);
    expect(r.totalPoints).toBeNull();
  });

  it('flags letter stair gaps', () => {
    const r = evaluate(
      row({ khTechnical: 'F', khBreadth: 'I', khHumanRelations: '1', psEnvironment: 'C', psChallenge: '2', acFreedom: 'C', acMagnitude: '1', acImpact: 'C' }),
      DEFAULT_GRADES,
    );
    expect(r.checks).toContain('Letter stair gap >1');
  });

  it('re-banding with a custom grade structure changes the grade', () => {
    const grades = generateGrades(10, 100, 3000);
    expect(grades).toHaveLength(10);
    expect(grades[0].minPoints).toBe(0);
    const r = evaluate(
      row({ khTechnical: 'F', khBreadth: 'II', khHumanRelations: '2', psEnvironment: 'E', psChallenge: '4', acFreedom: 'E', acMagnitude: '3', acImpact: 'C' }),
      grades,
    );
    expect(r.grade).toBeGreaterThan(1);
    expect(r.grade).toBeLessThanOrEqual(10);
  });
});
