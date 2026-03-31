import { Contact, Interview, JobLead, Template } from '@/types';
import { hydrateJob } from './scoring';

const contacts: Contact[] = [
  { id: 'c1', name: 'Rachel King', company: 'Scale Army', title: 'Talent Partner', relationshipType: 'RECRUITER', outreachDate: '2026-03-22', nextFollowUp: '2026-03-31', notes: 'Reached out on LinkedIn.' },
  { id: 'c2', name: 'Marta Silva', company: 'Outlive', title: 'Engineering Recruiter', relationshipType: 'RECRUITER', outreachDate: '2026-03-26', nextFollowUp: '2026-04-02' },
  { id: 'c3', name: 'John E.', company: 'Deel', title: 'Referral', relationshipType: 'REFERRAL', responseDate: '2026-03-28', notes: 'Warm intro pending.' },
];

const interviews: Interview[] = [
  { id: 'i1', company: 'Scale Army', title: 'AI-Assisted Full Stack Engineer', stage: 'VIDEO', interviewType: 'VIDEO', scheduledAt: '2026-04-02T16:00:00.000Z', outcome: 'PENDING', prepStatus: 'IN_PROGRESS' },
  { id: 'i2', company: 'Outlive', title: 'Backend Engineer', stage: 'RECRUITER_CALL', interviewType: 'VIDEO', scheduledAt: '2026-04-05T14:00:00.000Z', outcome: 'PENDING', prepStatus: 'NOT_STARTED' },
];

export const demoJobs: JobLead[] = [
  {
    id: 'j1',
    company: 'Scale Army',
    title: 'AI-Assisted Full Stack Engineer',
    source: 'Ashby',
    jobUrl: 'https://jobs.ashbyhq.com',
    location: 'Remote',
    remoteType: 'Fully Remote',
    timezoneRequirement: 'EST / CST-friendly',
    eligibilityRegion: 'Africa, LATAM, Eastern Europe',
    salaryMin: 2800,
    salaryMax: 3300,
    currency: 'USD',
    notes: 'Excellent fit on stack, timezone workable, video required.',
    status: 'APPLYING' as const,
    dateFound: '2026-03-28',
    nextFollowUp: '2026-04-03',
    priorityFlag: 'MONITOR' as const,
    score: { coreStackMatch: 5, roleAlignment: 5, seniorityFit: 4, geographyEligibility: 5, timezoneCompatibility: 4, compensationFit: 5, domainRelevance: 4, applicationFriction: 3, signalQuality: 5, fitScore: 0, fitTier: 'A' as const },
    checklist: { resumeTailored: true, pdfChecked: true, coverLetterReady: true, portfolioAdded: true, videoDone: false, compensationChecked: true, eligibilityChecked: true, submitted: false },
    contacts: [contacts[0]],
    interviews: [interviews[0]],
    prepPack: { whyThisRole: 'Strong fit on modern TypeScript stack and AI-assisted workflow.', topFitPoints: 'Next.js, NestJS, PostgreSQL, remote collaboration, debugging.', likelyQuestions: 'How do you validate AI-generated code?', questionsToAsk: 'What parts of the platform are most fragile today?', technicalFocus: 'Architecture review, security awareness, production stability.', companyResearchLinks: 'https://careers.scalearmy.com', prepScore: 82, prepStatus: 'IN_PROGRESS' }
  },
  {
    id: 'j2',
    company: 'Outlive',
    title: 'Backend Engineer',
    source: 'Greenhouse',
    jobUrl: 'https://job-boards.greenhouse.io',
    location: 'Remote',
    remoteType: 'Remote',
    timezoneRequirement: 'US overlap',
    eligibilityRegion: 'Worldwide',
    salaryMin: 3500,
    salaryMax: 4500,
    currency: 'USD',
    notes: 'Stretch on seniority but good Node/Nest alignment.',
    status: 'LEAD' as const,
    dateFound: '2026-03-29',
    priorityFlag: 'MONITOR' as const,
    score: { coreStackMatch: 4, roleAlignment: 4, seniorityFit: 3, geographyEligibility: 5, timezoneCompatibility: 4, compensationFit: 4, domainRelevance: 3, applicationFriction: 4, signalQuality: 4, fitScore: 0, fitTier: 'B' as const },
    checklist: { resumeTailored: false, pdfChecked: false, coverLetterReady: false, portfolioAdded: true, videoDone: false, compensationChecked: false, eligibilityChecked: true, submitted: false },
    contacts: [contacts[1]],
    interviews: [interviews[1]],
    prepPack: { whyThisRole: 'Strong backend alignment.', topFitPoints: 'Node.js, TypeScript, PostgreSQL.', likelyQuestions: 'API performance and architecture decisions.', questionsToAsk: 'How is the backend team structured?', technicalFocus: 'Backend services and query optimization.', companyResearchLinks: 'https://outlive.com', prepScore: 55, prepStatus: 'NOT_STARTED' }
  },
  {
    id: 'j3',
    company: 'Deel',
    title: 'Full Stack Engineer',
    source: 'Arc',
    jobUrl: 'https://arc.dev',
    location: 'Remote',
    remoteType: 'Remote',
    timezoneRequirement: 'Global / overlap preferred',
    eligibilityRegion: 'Worldwide',
    salaryMin: 3000,
    salaryMax: 4000,
    currency: 'USD',
    notes: 'Good role, worth tailoring after Scale Army.',
    status: 'SAVED' as const,
    dateFound: '2026-03-30',
    priorityFlag: 'MONITOR' as const,
    score: { coreStackMatch: 4, roleAlignment: 5, seniorityFit: 4, geographyEligibility: 5, timezoneCompatibility: 5, compensationFit: 4, domainRelevance: 4, applicationFriction: 3, signalQuality: 4, fitScore: 0, fitTier: 'B' as const },
    checklist: { resumeTailored: false, pdfChecked: false, coverLetterReady: false, portfolioAdded: true, videoDone: false, compensationChecked: true, eligibilityChecked: true, submitted: false },
    contacts: [contacts[2]],
    interviews: [],
    prepPack: { whyThisRole: 'Strong full-stack overlap.', topFitPoints: 'React, Node.js, Postgres, remote product work.', likelyQuestions: 'Cross-functional collaboration examples.', questionsToAsk: 'What are the main product priorities?', technicalFocus: 'Product velocity and maintainability.', companyResearchLinks: 'https://deel.com', prepScore: 49, prepStatus: 'NOT_STARTED' }
  }
].map(hydrateJob);

export const demoContacts = contacts;
export const demoInterviews = interviews;
export const demoTemplates: Template[] = [
  { id: 't1', type: 'RECRUITER_OUTREACH', name: 'Recruiter Intro', subject: 'Full-Stack Engineer interested in your role', body: 'Hi {{name}}, I came across the {{role}} opening and it looks strongly aligned with my background in TypeScript, Next.js, Node.js, and PostgreSQL...' },
  { id: 't2', type: 'APPLICATION_FOLLOW_UP', name: 'Application Follow-Up', subject: 'Following up on my application', body: 'Hi {{name}}, I wanted to follow up on my application for {{role}} and reiterate my interest...' },
  { id: 't3', type: 'POST_INTERVIEW_THANK_YOU', name: 'Thank You', subject: 'Thank you for the conversation', body: 'Thank you for taking the time to speak with me today...' }
];
