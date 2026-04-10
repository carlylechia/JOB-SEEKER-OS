import { Contact, Interview, JobLead, Template } from '@/types';

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
    notes: 'Excellent fit on stack, timezone workable, video required. Modern TypeScript, Next.js, NestJS, PostgreSQL.',
    status: 'APPLYING',
    dateFound: '2026-03-28',
    nextFollowUp: '2026-04-03',
    priorityFlag: 'MONITOR',
    score: { coreStackMatch: 5, roleAlignment: 5, seniorityFit: 4, geographyEligibility: 5, timezoneCompatibility: 4, compensationFit: 5, domainRelevance: 4, applicationFriction: 3, signalQuality: 5, fitScore: 0, fitTier: 'A' },
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
    notes: 'Stretch on seniority but good Node/Nest alignment. TypeScript backend, PostgreSQL, Docker.',
    status: 'LEAD',
    dateFound: '2026-03-29',
    priorityFlag: 'MONITOR',
    score: { coreStackMatch: 4, roleAlignment: 4, seniorityFit: 3, geographyEligibility: 5, timezoneCompatibility: 4, compensationFit: 4, domainRelevance: 3, applicationFriction: 4, signalQuality: 4, fitScore: 0, fitTier: 'B' },
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
    notes: 'Good role, worth tailoring after Scale Army. React, Node.js, Postgres, distributed remote product work.',
    status: 'SAVED',
    dateFound: '2026-03-30',
    priorityFlag: 'MONITOR',
    score: { coreStackMatch: 4, roleAlignment: 5, seniorityFit: 4, geographyEligibility: 5, timezoneCompatibility: 5, compensationFit: 4, domainRelevance: 4, applicationFriction: 3, signalQuality: 4, fitScore: 0, fitTier: 'B' },
    checklist: { resumeTailored: false, pdfChecked: false, coverLetterReady: false, portfolioAdded: true, videoDone: false, compensationChecked: true, eligibilityChecked: true, submitted: false },
    contacts: [contacts[2]],
    interviews: [],
    prepPack: { whyThisRole: 'Strong full-stack overlap.', topFitPoints: 'React, Node.js, Postgres, remote product work.', likelyQuestions: 'Cross-functional collaboration examples.', questionsToAsk: 'What are the main product priorities?', technicalFocus: 'Product velocity and maintainability.', companyResearchLinks: 'https://deel.com', prepScore: 49, prepStatus: 'NOT_STARTED' }
  }
];

export const demoContacts = contacts;
export const demoInterviews = interviews;
export const demoTemplates: Template[] = [
  // intro
  { id: 't-intro-1', type: 'intro', name: 'Recruiter Cold Intro', subject: 'Full-Stack Engineer interested in your role', body: 'Hi {{name}},\n\nI came across the {{role}} opening at {{company}} and it looks strongly aligned with my background in TypeScript, Next.js, Node.js, and PostgreSQL. I have built and shipped production-grade systems—including auth flows, REST/GraphQL APIs, and data-intensive dashboards—and I work well in async, globally distributed teams.\n\nWould you be open to a quick 15-minute chat this week?\n\nBest,\n[Your Name]' },
  { id: 't-intro-2', type: 'intro', name: 'Warm Referral Intro', subject: 'Referred by {{referral}} — {{role}} opening', body: 'Hi {{name}},\n\n{{referral}} suggested I reach out about the {{role}} position at {{company}}. I have been building full-stack applications for several years, most recently with React, Node.js, and cloud infrastructure on AWS. I would love to learn more about the role and explore whether it could be a good mutual fit.\n\nHappy to share my resume or portfolio at your convenience.\n\nThanks,\n[Your Name]' },
  { id: 't-intro-3', type: 'intro', name: 'LinkedIn InMail Intro', subject: 'Your {{role}} role caught my eye', body: 'Hi {{name}},\n\nI noticed the {{role}} opening at {{company}} and wanted to introduce myself. My background is in building scalable web applications with TypeScript, React, and Node.js—I enjoy solving complex product problems and improving developer experience.\n\nI would be glad to connect and learn more about what you are working on.\n\nBest,\n[Your Name]' },
  { id: 't-intro-4', type: 'intro', name: 'Job Board Application Cover', subject: 'Application: {{role}} at {{company}}', body: 'Hi {{name}},\n\nI am applying for the {{role}} position at {{company}}. I bring strong full-stack experience with a focus on TypeScript, Next.js, and PostgreSQL, with a track record delivering production systems used by real users at scale.\n\nI have attached my resume and am happy to complete a take-home or discuss my work in a call.\n\nLooking forward to hearing from you.\n\n[Your Name]' },
  // follow_up
  { id: 't-follow-1', type: 'follow_up', name: 'Application Follow-Up', subject: 'Following up on my application — {{role}}', body: 'Hi {{name}},\n\nI wanted to follow up on my application for the {{role}} role at {{company}} submitted on {{date}}. I remain very interested in the position and would welcome the chance to discuss how my experience could contribute to the team.\n\nPlease let me know if there is anything else I can provide.\n\nThank you,\n[Your Name]' },
  { id: 't-follow-2', type: 'follow_up', name: 'Post-Interview Follow-Up', subject: 'Following up after our conversation', body: 'Hi {{name}},\n\nThank you for taking the time to speak with me about the {{role}} role at {{company}}. I enjoyed learning more about the team\'s direction and remain genuinely excited about the opportunity.\n\nI wanted to follow up and see if there have been any updates on the timeline or next steps.\n\nBest,\n[Your Name]' },
  { id: 't-follow-3', type: 'follow_up', name: 'Referral Follow-Up', subject: 'Checking in on my application at {{company}}', body: 'Hi {{name}},\n\nI wanted to check in regarding my application for the {{role}} position. I was referred by {{referral}} and have been following {{company}}\'s work closely—I would love to contribute to what you are building.\n\nIs there any update you can share on the timeline?\n\nThanks,\n[Your Name]' },
  // thank_you
  { id: 't-ty-1', type: 'thank_you', name: 'Post-Screening Thank You', subject: 'Thank you for the conversation, {{name}}', body: 'Hi {{name}},\n\nThank you for the time today—it was great to learn more about the {{role}} role at {{company}} and the team\'s current challenges. Our conversation reinforced my excitement about the opportunity.\n\nI look forward to the next steps and am happy to provide any additional information in the meantime.\n\nBest,\n[Your Name]' },
  { id: 't-ty-2', type: 'thank_you', name: 'Post-Technical Interview Thank You', subject: 'Thank you for the technical interview', body: 'Hi {{name}},\n\nI really enjoyed the technical discussion today. Working through the problem together gave me a clearer picture of {{company}}\'s engineering culture—and I left the conversation even more motivated to join the team.\n\nI look forward to hearing about next steps.\n\nThanks,\n[Your Name]' },
  { id: 't-ty-3', type: 'thank_you', name: 'Final Panel Thank You', subject: 'Thank you — {{role}} panel interview', body: 'Hi {{name}},\n\nThank you for coordinating today\'s panel interview for the {{role}} role. I appreciated the depth of the conversations with each team member and came away with a strong sense of the work ahead. I am very much hoping to be part of it.\n\nPlease feel free to reach out if there is anything else you need from me.\n\n[Your Name]' },
  // check_in
  { id: 't-ci-1', type: 'check_in', name: 'Dormant Application Check-In', subject: 'Checking in — {{role}} at {{company}}', body: 'Hi {{name}},\n\nI hope you are well. I applied for the {{role}} role at {{company}} a few weeks ago and wanted to touch base. I remain genuinely interested and would love to know if the position is still active or if there is a better time to reconnect.\n\nThank you for your time,\n[Your Name]' },
  { id: 't-ci-2', type: 'check_in', name: 'Offer Decision Check-In', subject: 'Following up on next steps', body: 'Hi {{name}},\n\nI wanted to follow up on the timeline for the {{role}} offer at {{company}}. I have been exploring a few options and want to ensure I handle everything respectfully on your end. Could you let me know if there is an expected decision date?\n\nThank you,\n[Your Name]' },
  { id: 't-ci-3', type: 'check_in', name: 'Relationship Keep-Warm', subject: 'Staying in touch', body: 'Hi {{name}},\n\nI hope things are going well at {{company}}. We connected a while back regarding opportunities there, and I wanted to stay on your radar—I continue to follow the company\'s growth with interest. Please do not hesitate to reach out if a relevant role opens up.\n\nBest,\n[Your Name]' },
  // referral
  { id: 't-ref-1', type: 'referral', name: 'Referral Request to Contact', subject: 'Quick favour — referral at {{company}}', body: 'Hi {{name}},\n\nI hope you are doing well! I noticed {{company}} is hiring for a {{role}} and I am very interested. Would you be comfortable referring me or passing my profile along to the right person on the team? I think my background in TypeScript, React, and Node.js could be a strong fit.\n\nHappy to send over my resume or portfolio. Really appreciate any help!\n\n[Your Name]' },
  { id: 't-ref-2', type: 'referral', name: 'Referral Thank You', subject: 'Thank you for the referral!', body: 'Hi {{name}},\n\nThank you so much for referring me to {{company}} for the {{role}} role—I really appreciate you putting in a word. I just submitted my application and am hoping for the best.\n\nI will keep you posted on how it progresses. Truly grateful for your support!\n\n[Your Name]' },
  { id: 't-ref-3', type: 'referral', name: 'Alumni Network Referral Ask', subject: 'Fellow alum seeking referral at {{company}}', body: 'Hi {{name}},\n\nI found your profile through our alumni network—congratulations on your role at {{company}}! I am currently exploring new opportunities and came across a {{role}} opening that looks like a great fit for my background.\n\nWould you be open to a brief chat or willing to refer me internally? I would not want to impose of course, so no pressure at all.\n\nThank you,\n[Your Name]' },
];

