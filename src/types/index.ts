export type JobStatus = 'LEAD' | 'SAVED' | 'APPLYING' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'ARCHIVED';
export type FitTier = 'A' | 'B' | 'C' | 'D';
export type PriorityFlag = 'APPLY_TODAY' | 'APPLY_THIS_WEEK' | 'PREPARE_ASSETS' | 'FOLLOW_UP_DUE' | 'INTERVIEW_SOON' | 'CHECK_DUPLICATE' | 'MONITOR' | 'SKIP';
export type SeniorityLevel = 'ENTRY' | 'MID' | 'SENIOR' | 'FLEXIBLE';
export type WorkRegion = 'US' | 'EU' | 'AFRICA' | 'WORLDWIDE' | 'FLEXIBLE';

export type ScoreFields = {
  coreStackMatch: number;
  roleAlignment: number;
  seniorityFit: number;
  geographyEligibility: number;
  timezoneCompatibility: number;
  compensationFit: number;
  domainRelevance: number;
  applicationFriction: number;
  signalQuality: number;
};

export type UserPreferences = {
  currentLevel: SeniorityLevel;
  targetLevel: SeniorityLevel;
  targetRoles: string[];
  preferredRegions: string[];
  preferredTitles: string[];
  preferredStack: string[];
  mustHaveTech: string[];
  workRegions: WorkRegion[];
  remoteOnly: boolean;
  salaryMin: number;
  salaryTarget: number;
  timezoneToleranceHours: number;
};

export type Checklist = {
  resumeTailored: boolean;
  pdfChecked: boolean;
  coverLetterReady: boolean;
  portfolioAdded: boolean;
  videoDone: boolean;
  compensationChecked: boolean;
  eligibilityChecked: boolean;
  submitted: boolean;
};

export type Contact = {
  id: string;
  name: string;
  company: string;
  title: string;
  relationshipType: string;
  outreachDate?: string;
  responseDate?: string;
  nextFollowUp?: string;
  notes?: string;
};

export type Interview = {
  id: string;
  company: string;
  title: string;
  stage: string;
  interviewType: string;
  scheduledAt: string;
  outcome: string;
  prepStatus: string;
};

export type PrepPack = {
  whyThisRole: string;
  topFitPoints: string;
  likelyQuestions: string;
  questionsToAsk: string;
  technicalFocus: string;
  companyResearchLinks: string;
  prepScore: number;
  prepStatus: string;
};

export type JobLead = {
  id: string;
  company: string;
  title: string;
  source: string;
  jobUrl: string;
  location: string;
  remoteType: string;
  timezoneRequirement: string;
  eligibilityRegion: string;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  notes: string;
  status: JobStatus;
  dateFound: string;
  dateApplied?: string;
  nextFollowUp?: string;
  priorityFlag: PriorityFlag;
  score: ScoreFields & { fitScore: number; fitTier: FitTier };
  checklist: Checklist;
  contacts: Contact[];
  interviews: Interview[];
  prepPack: PrepPack;
};

export type Template = {
  id: string;
  type: string;
  name: string;
  subject?: string;
  body: string;
};
