import { prisma } from '@/lib/prisma';
import { WeeklyReview } from './types';

export async function buildWeeklyReview(userId: string): Promise<WeeklyReview> {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [jobsUpdated, applicationsSubmitted, followUpsCompleted, practiceAttempts, queueCompleted, overdueActions, upcomingFollowUps] = await Promise.all([
    prisma.jobLead.count({ where: { userId, updatedAt: { gte: periodStart }, deletedAt: null } }),
    prisma.jobLead.count({ where: { userId, dateApplied: { gte: periodStart }, deletedAt: null } }),
    prisma.careerAction.count({ where: { userId, actionType: 'FOLLOW_UP_DUE', status: 'COMPLETED', completedAt: { gte: periodStart } } }),
    prisma.interviewPracticeAttempt.count({ where: { userId, createdAt: { gte: periodStart } } }),
    prisma.careerAction.count({ where: { userId, status: 'COMPLETED', completedAt: { gte: periodStart } } }),
    prisma.careerAction.count({ where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: now } } }),
    prisma.jobLead.count({ where: { userId, nextFollowUp: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }, deletedAt: null } }),
  ]);

  const insights: string[] = [];
  if (overdueActions > 0) insights.push(`You have ${overdueActions} overdue action${overdueActions > 1 ? 's' : ''} to address.`);
  if (upcomingFollowUps > 0) insights.push(`${upcomingFollowUps} follow-up${upcomingFollowUps > 1 ? 's' : ''} are due in the next 7 days.`);
  if (queueCompleted > 0) insights.push(`You completed ${queueCompleted} queue action${queueCompleted > 1 ? 's' : ''} this week.`);
  if (practiceAttempts > 0) insights.push(`You completed ${practiceAttempts} interview practice session${practiceAttempts > 1 ? 's' : ''}.`);
  if (applicationsSubmitted === 0) insights.push('No applications were recorded this week (only applications tracked in teChia Jobs are counted).');
  if (insights.length === 0) insights.push('No notable activity was recorded this week.');

  const limitations = [
    'Metrics reflect records stored in teChia Jobs only.',
    'Applications submitted outside the app are not tracked.',
  ];

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    metrics: {
      jobsReviewed: jobsUpdated,
      applicationsSubmitted,
      followUpsCompleted,
      interviewSessionsCompleted: practiceAttempts,
      queueActionsCompleted: queueCompleted,
      overdueActions,
      upcomingCommitments: upcomingFollowUps,
    },
    insights,
    limitations,
  };
}
