import { describe, expect, it } from 'vitest';
import { buildConsensus, totalPoints } from '../shared/consensus';
import { EMPTY_INPUTS, type EvaluationInputs } from '../shared/engine';

const r = (p: Partial<EvaluationInputs>): EvaluationInputs => ({
  ...EMPTY_INPUTS,
  khTechnical: 'E', khBreadth: 'I', khHumanRelations: '2', psEnvironment: 'E', psChallenge: '3',
  acFreedom: 'E', acMagnitude: '2', acImpact: 'C',
  ...p,
});

describe('consensus', () => {
  it('takes the most common level per element', () => {
    const c = buildConsensus([r({ khTechnical: 'E' }), r({ khTechnical: 'F' }), r({ khTechnical: 'E' })])!;
    expect(c.inputs.khTechnical).toBe('E');
    expect(c.elements.khTechnical).toMatchObject({ votes: 2, total: 3, disagreement: true });
    expect(c.elements.khBreadth.disagreement).toBe(false);
  });

  it('breaks a single two-way tie toward the lower level when both are equally close to the median total', () => {
    const c = buildConsensus([r({ psChallenge: '3' }), r({ psChallenge: '4' })])!;
    expect(c.inputs.psChallenge).toBe('3');
  });

  it('resolves ties so the total stays within the evaluators’ range', () => {
    // FIN-15 demo case: two evaluators split on three elements.
    const a = r({ khTechnical: 'F', khHumanRelations: '3', psChallenge: '3', acMagnitude: '3', acImpact: 'S' });
    const b = r({ khTechnical: 'E', khHumanRelations: '3', psChallenge: '4', acMagnitude: '3', acImpact: 'P' });
    const ta = totalPoints(a)!;
    const tb = totalPoints(b)!;
    const c = buildConsensus([a, b])!;
    const t = totalPoints(c.inputs)!;
    expect(t).toBeGreaterThanOrEqual(Math.min(ta, tb));
    expect(t).toBeLessThanOrEqual(Math.max(ta, tb));
    // every chosen level is still one an evaluator picked
    expect([a.khTechnical, b.khTechnical]).toContain(c.inputs.khTechnical);
  });

  it('breaks a spread tie toward the median rating', () => {
    const c = buildConsensus([r({ acFreedom: 'D' }), r({ acFreedom: 'E' }), r({ acFreedom: 'G' })])!;
    expect(c.inputs.acFreedom).toBe('E');
  });

  it('ignores impact from magnitude-N ratings and blanks impact when N wins', () => {
    const c = buildConsensus([r({ acMagnitude: 'N', acImpact: '' }), r({ acMagnitude: '2', acImpact: 'P' }), r({ acMagnitude: '2', acImpact: 'S' })])!;
    expect(c.inputs.acMagnitude).toBe('2');
    expect(c.elements.acImpact.total).toBe(2);
    const n = buildConsensus([r({ acMagnitude: 'N', acImpact: '' }), r({ acMagnitude: 'N', acImpact: '' }), r({ acMagnitude: '2', acImpact: 'P' })])!;
    expect(n.inputs.acMagnitude).toBe('N');
    expect(n.inputs.acImpact).toBe('');
  });

  it('returns null with no ratings', () => {
    expect(buildConsensus([])).toBeNull();
  });
});
