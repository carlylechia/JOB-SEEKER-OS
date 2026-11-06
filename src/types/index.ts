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
  timezoneMatches: string[];
  remoteOnly: boolean;
  salaryMin: number;
  salaryTarget: number;
  timezoneToleranceHours: number;
  /** IANA timezone; controls the user's local snapshot day. */
  timezone: string;
  /** ISO 3166-1 alpha-2 work countries, empty means unrestricted. */
  workCountries: string[];
  /** Normalized employment types the user will consider, empty means all. */
  employmentTypes: string[];
  preferredIndustries: string[];
  visaSponsorshipRequired: boolean;
};

export type UserProfileDetails = {
  fullName: string;
  headline: string;
  portfolioUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  resumeUrl: string;
  profilePictureUrl: string;
  profileCompleted: boolean;
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
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  outreachDate?: string;
  responseDate?: string;
  nextFollowUp?: string;
  notes?: string;
};

export type JobRequirements = {
  mustHave: string[];
  niceToHave: string[];
  responsibilities: string[];
  qualifications: string[];
  benefits: string[];
};

export type CompanyProfile = {
  website: string;
  linkedinUrl: string;
  size: string;
  industry: string;
  description: string;
};

export type JobIngestionMeta = {
  mode: JobIngestionResult['sourceMode'];
  aiUsed: boolean;
  model?: string;
  images: number;
  confidence?: number;
  warnings: string[];
  extractedAt: string;
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
  employmentType?: string;
  seniority?: string;
  category?: string;
  industry?: string;
  skills?: string[];
  requirements?: JobRequirements;
  companyProfile?: CompanyProfile;
  ingestionMeta?: JobIngestionMeta | null;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  notes: string;
  /**
   * The pasted job description. Distinct from `notes`: this is the employer's
   * text, which the analysis path treats as untrusted input.
   */
  jobDescription: string;
  status: JobStatus;
  dateFound: string;
  dateApplied?: string;
  nextFollowUp?: string;
  priorityFlag: PriorityFlag;
  score: ScoreFields & { fitScore: number; fitTier: FitTier; titleMatch?: boolean };
  checklist: Checklist;
  contacts: Contact[];
  interviews: Interview[];
  prepPack: PrepPack;
};

export type JobFormValues = {
  company: string;
  title: string;
  source: string;
  jobUrl: string;
  location: string;
  remoteType: string;
  timezoneRequirement: string;
  eligibilityRegion: string;
  employmentType: string;
  seniority: string;
  category: string;
  industry: string;
  skills: string[];
  requirements: JobRequirements;
  companyProfile: CompanyProfile;
  contacts: Contact[];
  ingestionMeta?: JobIngestionMeta | null;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  notes: string;
  jobDescription: string;
  status: JobStatus;
  nextFollowUp: string;
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

export type JobIngestionSourceMode =
  | 'url'
  | 'description'
  | 'url+description'
  | 'image'
  | 'image+description'
  | 'image+url'
  | 'image+url+description';

export type JobIngestionResult = {
  prefill: Partial<JobFormValues>;
  signals: string[];
  previewText: string;
  fetchedUrl?: string;
  sourceMode: JobIngestionSourceMode;
  ai: {
    used: boolean;
    model?: string;
    fallbackReason?: string;
  };
  imageCount: number;
  confidence?: number;
  warnings?: string[];
};

export type ApiError = {
  error: string;
  details?: string[];
};

export type Template = {
  id: string;
  type: string;
  name: string;
  subject?: string;
  body: string;
};

export type QueueTask = {
  taskId: string;
  type: 'APPLY' | 'FOLLOW_UP' | 'FOLLOW_UP_NOW' | 'PREPARE';
  label: string;
  description: string;
  jobId: string;
  company: string;
  title: string;
  priority: PriorityFlag;
  fitScore: number;
  fitTier: FitTier;
  dueDate?: string;
};

export type CareerAction = {
  id: string;
  userId: string;
  actionType: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  dueDate: string | null;
  estimatedMinutes: number | null;
  sourceType: string;
  sourceId: string | null;
  relatedJobId: string | null;
  relatedResumeId: string | null;
  relatedPrepPackId: string | null;
  origin: string;
  snoozedUntil: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnrichedContact = Contact & {
  jobId: string;
  jobTitle: string;
  jobCompany: string;
};

export type WorkspaceStats = {
  /** Roles still being actively pursued (offer, rejected and archived excluded). */
  activeApplications: number;
  /** Active roles added to the workspace in the last seven days. */
  activeApplicationsThisWeek: number;
  /** Bespoke resume variants generated from the career profile or a target job. */
  tailoredResumes: number;
  /** Tailored resume variants created in the last seven days. */
  tailoredResumesThisWeek: number;
  /** Recorded interviews divided by applications that have been submitted. */
  interviewSuccessRate: number;
  applicationsTracked: number;
  interviewsRecorded: number;
  /** Highest continuous daily engagement streak the user has ever reached. */
  streakRecord: number;
};

export type BootstrapPayload = {
  jobs: JobLead[];
  templates: Template[];
  preferences: UserPreferences;
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
  profile: UserProfileDetails;
  titleOptions: string[];
  streakCount: number;
  streakActiveToday?: boolean;
  streakAtRisk?: boolean;
  stats?: WorkspaceStats;
};
