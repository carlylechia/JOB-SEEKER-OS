export type CareerActionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';

export type CareerActionOrigin = 'SYSTEM' | 'USER' | 'AI';

export type CareerActionType =
  | 'FOLLOW_UP_DUE'
  | 'REVIEW_OPPORTUNITY'
  | 'APPLY_TO_JOB'
  | 'TAILOR_RESUME'
  | 'REVIEW_APPLICATION_MATERIAL'
  | 'FINALIZE_COVER_LETTER'
  | 'PREPARE_INTERVIEW'
  | 'PRACTICE_INTERVIEW_QUESTION'
  | 'REVIEW_INTERVIEW_FEEDBACK'
  | 'COMPLETE_PROFILE'
  | 'REVIEW_WEEKLY_PROGRESS'
  | 'REVIEW_JOB_DETAILS';

export type CareerActionSource =
  | 'APPLICATION_RECORD'
  | 'JOB_FOLLOW_UP'
  | 'JOB_MATCH'
  | 'RESUME'
  | 'APPLICATION_MATERIAL'
  | 'INTERVIEW_PREPARATION'
  | 'CAREER_PROFILE'
  | 'USER_CREATED'
  | 'CAREER_REVIEW';

export type CareerActionInput = {
  userId: string;
  actionType: CareerActionType;
  title: string;
  description?: string | null;
  status?: CareerActionStatus;
  priority?: number;
  dueDate?: Date | null;
  estimatedMinutes?: number | null;
  sourceType: CareerActionSource;
  sourceId?: string | null;
  relatedJobId?: string | null;
  relatedResumeId?: string | null;
  relatedPrepPackId?: string | null;
  origin?: CareerActionOrigin;
  snoozedUntil?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export type CareerActionRecord = {
  id: string;
  userId: string;
  actionType: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  sourceType: string;
  sourceId: string | null;
  relatedJobId: string | null;
  relatedResumeId: string | null;
  relatedPrepPackId: string | null;
  origin: string;
  snoozedUntil: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type WeeklyReview = {
  periodStart: string;
  periodEnd: string;
  metrics: {
    jobsReviewed: number;
    applicationsSubmitted: number;
    followUpsCompleted: number;
    interviewSessionsCompleted: number;
    queueActionsCompleted: number;
    overdueActions: number;
    upcomingCommitments: number;
  };
  insights: string[];
  limitations: string[];
};
