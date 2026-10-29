/**
 * Streak and daily-digest behaviour.
 *
 * The bug this guards against: the old engine only advanced on writes, so a
 * user who opened the app every day but changed nothing was treated as absent.
 * It also used UTC calendar days, which reset streaks for users whose evening
 * was already "tomorrow" in UTC.
 */

import { describe, it, expect, afterEach } from './harness';
import assert from 'node:assert/strict';

import { prisma } from '@/lib/prisma';
import { addDaysToDateKey, dateKeyInTimeZone } from '@/lib/calendar';
import { deriveStreak } from '@/lib/streak-core';
import { touchStreak, getStreakStatus, sendStreakRiskNotifications } from '@/lib/streak';
import { buildDailyDigest, pickMotivation, sendDailyDigest } from '@/lib/daily-digest';
import { createUser, destroyUser } from './helpers';

const createdUsers: string[] = [];

async function makeUser() {
  const user = await createUser();
  createdUsers.push(user.id);
  return user;
}

afterEach(async () => {
  for (const id of createdUsers.splice(0)) {
    await destroyUser(id).catch(() => undefined);
  }
});

describe('calendar days', () => {
  it('uses the user timezone rather than UTC', () => {
    const instant = new Date('2026-10-29T02:00:00.000Z');
    expect(dateKeyInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-28');
    expect(dateKeyInTimeZone(instant, 'UTC')).toBe('2026-10-29');
    expect(dateKeyInTimeZone(instant, 'Pacific/Kiritimati')).toBe('2026-10-29');
  });

  it('falls back to UTC for an invalid timezone instead of throwing', () => {
    expect(dateKeyInTimeZone(new Date('2026-10-29T12:00:00.000Z'), 'Not/AZone')).toBe('2026-10-29');
  });

  it('adds days without drifting across month or year boundaries', () => {
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('streak rules', () => {
  const at = new Date('2026-03-10T12:00:00.000Z');

  it('keeps the streak when the user was already active today', () => {
    const streak = deriveStreak(7, new Date('2026-03-10T08:00:00.000Z'), at, 'UTC');
    expect(streak.streakCount).toBe(7);
    expect(streak.activeToday).toBe(true);
    expect(streak.isAtRisk).toBe(false);
  });

  it('marks yesterday as at risk but still alive', () => {
    const streak = deriveStreak(7, new Date('2026-03-09T22:00:00.000Z'), at, 'UTC');
    expect(streak.streakCount).toBe(7);
    expect(streak.activeToday).toBe(false);
    expect(streak.isAtRisk).toBe(true);
  });

  it('ends the run once a full day has been missed', () => {
    const streak = deriveStreak(7, new Date('2026-03-08T22:00:00.000Z'), at, 'UTC');
    expect(streak.streakCount).toBe(0);
    expect(streak.activeToday).toBe(false);
    expect(streak.isAtRisk).toBe(false);
  });

  it('does not reset a user whose local day is still yesterday in UTC', () => {
    const instant = new Date('2026-10-29T02:00:00.000Z');
    const lastActive = new Date('2026-10-28T20:00:00.000Z');
    const la = deriveStreak(4, lastActive, instant, 'America/Los_Angeles');
    const utc = deriveStreak(4, lastActive, instant, 'UTC');

    expect(la.streakCount).toBe(4);
    expect(la.activeToday).toBe(true);
    expect(utc.activeToday).toBe(false);
    expect(utc.isAtRisk).toBe(true);
  });

  it('reports the next milestone and days remaining', () => {
    const streak = deriveStreak(12, new Date('2026-03-10T08:00:00.000Z'), at, 'UTC');
    expect(streak.nextMilestone).toBe(14);
    expect(streak.daysToNextMilestone).toBe(2);
  });
});

describe('touchStreak', () => {
  it('counts a visit, is idempotent within the day, and starts fresh after a gap', async () => {
    const user = await makeUser();

    const first = await touchStreak(user.id, { at: new Date('2026-03-01T12:00:00.000Z') });
    expect(first.streakCount).toBe(1);
    expect(first.changed).toBe(true);

    const sameDay = await touchStreak(user.id, { at: new Date('2026-03-01T20:00:00.000Z') });
    expect(sameDay.streakCount).toBe(1);
    expect(sameDay.changed).toBe(false);

    const nextDay = await touchStreak(user.id, { at: new Date('2026-03-02T08:00:00.000Z') });
    expect(nextDay.streakCount).toBe(2);
    expect(nextDay.changed).toBe(true);

    const afterGap = await touchStreak(user.id, { at: new Date('2026-03-04T08:00:00.000Z') });
    expect(afterGap.streakCount).toBe(1);
    expect(afterGap.changed).toBe(true);
  });

  it('creates a milestone notification when a milestone is reached', async () => {
    const user = await makeUser();

    await touchStreak(user.id, { at: new Date('2026-03-01T12:00:00.000Z') });
    await touchStreak(user.id, { at: new Date('2026-03-02T12:00:00.000Z') });
    await touchStreak(user.id, { at: new Date('2026-03-03T12:00:00.000Z') });

    const note = await prisma.notification.findFirst({
      where: { userId: user.id, type: 'streak' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(note);
    expect(note!.title).toContain('3-day streak');
  });

  it('normalises a stale stored streak when read', async () => {
    const user = await makeUser();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        streakCount: 9,
        lastActiveDate: new Date('2026-03-01T12:00:00.000Z'),
      },
    });

    const status = await getStreakStatus(user.id, new Date('2026-03-05T12:00:00.000Z'));
    expect(status.streakCount).toBe(0);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.streakCount).toBe(0);
  });
});

describe('streak risk notifications', () => {
  it('warns once when yesterday was the last active day', async () => {
    const user = await makeUser();
    const at = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        streakCount: 4,
        lastActiveDate: new Date(at.getTime() - 24 * 60 * 60 * 1000),
      },
    });

    await sendStreakRiskNotifications(at);

    const firstCount = await prisma.notification.count({
      where: { userId: user.id, type: 'streak_risk' },
    });
    expect(firstCount).toBe(1);

    await sendStreakRiskNotifications(at);
    const secondCount = await prisma.notification.count({
      where: { userId: user.id, type: 'streak_risk' },
    });
    expect(secondCount).toBe(1);
  });
});

describe('daily digest', () => {
  it('picks the same motivation for the same user and day', () => {
    expect(pickMotivation('user-a', '2026-03-10')).toBe(pickMotivation('user-a', '2026-03-10'));
    expect(pickMotivation('user-a', '2026-03-10')).not.toBe(pickMotivation('user-a', '2026-03-11'));
  });

  it('lists the top three moves and ties them to the streak', () => {
    const content = buildDailyDigest({
      userId: 'user-a',
      firstName: 'Sam',
      dayKey: '2026-03-10',
      streak: deriveStreak(6, new Date('2026-03-09T20:00:00.000Z'), new Date('2026-03-10T12:00:00.000Z'), 'UTC'),
      tasks: [
        { title: 'Follow up with Acme', priority: 100, estimatedMinutes: 10 },
        { title: 'Apply to Beta', priority: 80, estimatedMinutes: 25 },
        { title: 'Practice interview questions', priority: 70, estimatedMinutes: 20 },
        { title: 'Review weekly progress', priority: 30, estimatedMinutes: 10 },
      ],
    });

    expect(content.title).toContain('Day 6');
    expect(content.message).toContain('Sam, your top 3 moves today:');
    expect(content.message).toContain('1. Follow up with Acme · 10 min');
    expect(content.message).toContain('+1 more waiting in your queue.');
    expect(content.message).toContain('streak is on the line');
    expect(content.message).toContain('Open your queue');
  });

  it('sends at most one digest per day and stores the queue reminder', async () => {
    const user = await makeUser();
    await prisma.jobLead.create({
      data: {
        userId: user.id,
        company: 'Acme',
        title: 'Engineer',
        status: 'SAVED',
        score: { fitScore: 90, fitTier: 'A' } as never,
        checklist: {} as never,
        contacts: [] as never,
        interviews: [] as never,
        prepPack: {} as never,
      },
    });

    const at = new Date();
    expect(await sendDailyDigest(user.id, { at })).toBe(true);

    const first = await prisma.notification.findMany({
      where: { userId: user.id, type: 'daily_digest' },
    });
    expect(first.length).toBe(1);
    expect(first[0].message).toContain('Open your queue');

    expect(await sendDailyDigest(user.id, { at })).toBe(false);
    const second = await prisma.notification.count({
      where: { userId: user.id, type: 'daily_digest' },
    });
    expect(second).toBe(1);
  });
});
