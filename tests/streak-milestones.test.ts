/**
 * Dynamic streak milestones.
 *
 * Guards the behaviour that replaced the old five-day ceiling: a streak past
 * the last scheduled milestone keeps receiving targets on a 100-day cadence
 * instead of being clamped, and every consumer shares the same progress maths.
 */

import { describe, it, expect } from './harness';

import {
  STREAK_MILESTONES,
  getStreakMilestoneProgress,
  isStreakMilestone,
  nextStreakMilestone,
  nextStreakMilestones,
  previousStreakMilestone,
} from '@/lib/streak-milestones';

describe('streak milestone ladder', () => {
  it('keeps generating targets after the five-day milestone', () => {
    expect(nextStreakMilestone(5)).toBe(7);
    expect(nextStreakMilestone(6)).toBe(7);

    const progress = getStreakMilestoneProgress(8);
    expect(progress.previous).toBe(7);
    expect(progress.next).toBe(14);
    expect(progress.remaining).toBe(6);
  });

  it('continues on a 100-day cadence beyond the final scheduled milestone', () => {
    expect(nextStreakMilestone(365)).toBe(465);
    expect(nextStreakMilestone(400)).toBe(465);
    expect(nextStreakMilestone(465)).toBe(565);
    expect(nextStreakMilestone(900)).toBe(965);

    expect(previousStreakMilestone(400)).toBe(365);
    expect(previousStreakMilestone(464)).toBe(365);
    expect(previousStreakMilestone(465)).toBe(465);
    expect(previousStreakMilestone(1000)).toBe(965);
  });

  it('lists several upcoming milestones in ascending order', () => {
    expect(nextStreakMilestones(8, 3)).toEqual([14, 21, 30]);
    expect(nextStreakMilestones(400, 3)).toEqual([465, 565, 665]);
    expect(nextStreakMilestones(8, 0)).toEqual([]);
  });

  it('never returns a next target at or below the current streak', () => {
    let cursor = 0;
    for (let index = 0; index < 25; index += 1) {
      const next = nextStreakMilestone(cursor);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(cursor).toBeGreaterThan(1000);
  });

  it('recognises scheduled and generated milestones only', () => {
    for (const milestone of STREAK_MILESTONES) {
      expect(isStreakMilestone(milestone)).toBe(true);
    }

    expect(isStreakMilestone(465)).toBe(true);
    expect(isStreakMilestone(565)).toBe(true);
    expect(isStreakMilestone(464)).toBe(false);
    expect(isStreakMilestone(0)).toBe(false);
  });

  it('reports progress between milestones without exceeding 100 percent', () => {
    const midLadder = getStreakMilestoneProgress(8);
    expect(Math.round(midLadder.percent)).toBe(14);

    const exact = getStreakMilestoneProgress(465);
    expect(exact.previous).toBe(465);
    expect(exact.next).toBe(565);
    expect(exact.remaining).toBe(100);
    expect(exact.percent).toBe(0);

    const nearNext = getStreakMilestoneProgress(464);
    expect(nearNext.previous).toBe(365);
    expect(nearNext.next).toBe(465);
    expect(nearNext.percent).toBeLessThan(100);
    expect(nearNext.remaining).toBe(1);
  });

  it('normalises invalid input instead of throwing or producing NaN', () => {
    expect(nextStreakMilestone(-4)).toBe(3);
    expect(nextStreakMilestone(Number.NaN)).toBe(3);
    expect(nextStreakMilestone(Number.POSITIVE_INFINITY)).toBe(3);
    expect(previousStreakMilestone(-4)).toBe(0);
    expect(isStreakMilestone(Number.NaN)).toBe(false);

    const progress = getStreakMilestoneProgress(Number.NaN);
    expect(progress.current).toBe(0);
    expect(progress.next).toBe(3);
    expect(progress.percent).toBe(0);
  });
});
