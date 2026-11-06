import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Star,
  ListChecks,
  Users,
  BookOpen,
  GitBranch,
  FileText,
  Brain,
  Calendar,
  Search,
} from 'lucide-react';

export type FeatureShowcaseItem = {
  icon: LucideIcon;
  title: string;
  /** Compact label used by the landing-page marquee. */
  shortTitle: string;
  description: string;
  accent: string;
};

/**
 * Shared feature catalogue for the landing-page marquee.
 *
 * Keeping the copy in one place means the marketing surface and any future
 * feature detail view describe the product in exactly the same terms.
 */
export const FEATURE_SHOWCASE: FeatureShowcaseItem[] = [
  {
    icon: Search,
    title: 'Daily Top 5 Job Discovery',
    shortTitle: 'Daily Top 5',
    description:
      'Receive a focused, personalized shortlist of relevant opportunities with fit signals and links to official application pages.',
    accent: 'text-accent-text',
  },
  {
    icon: Star,
    title: 'AI Fit Scoring',
    shortTitle: 'AI Fit Scoring',
    description:
      'Every job receives a fit score based on your preferences — stack, seniority, location, and remote priorities — so you know exactly what to focus on.',
    accent: 'text-warn-text',
  },
  {
    icon: Brain,
    title: 'AI Job Intelligence',
    shortTitle: 'Job Intelligence',
    description:
      'Understand why a job fits, which requirements need attention, and what to do next, with evidence-backed explanations that never override hard eligibility rules.',
    accent: 'text-accent-text',
  },
  {
    icon: FileText,
    title: 'Resume Intelligence',
    shortTitle: 'Resume Intelligence',
    description:
      'Upload a resume and build a structured, reviewable career profile that powers matching, tailoring, and application materials.',
    accent: 'text-muted',
  },
  {
    icon: FileText,
    title: 'Resume Builder & Optimization',
    shortTitle: 'Resume Builder',
    description:
      'Build structured resumes, create role-specific variants, and apply evidence-backed suggestions without inventing experience.',
    accent: 'text-success-text',
  },
  {
    icon: FileText,
    title: 'AI Application Materials',
    shortTitle: 'Application Materials',
    description:
      'Draft cover letters, recruiter outreach, and follow-ups from your real profile and job details, then review and edit before use.',
    accent: 'text-danger-text',
  },
  {
    icon: Calendar,
    title: 'Interview Preparation',
    shortTitle: 'Interview Prep',
    description:
      'Generate role-specific preparation packs, structure answers, and practise with feedback linked to the correct job.',
    accent: 'text-muted',
  },
  {
    icon: ListChecks,
    title: 'Daily Smart Queue',
    shortTitle: 'Smart Queue',
    description:
      'A curated, ranked list of jobs and actions that need your attention today, including follow-ups and stale leads.',
    accent: 'text-accent-text',
  },
  {
    icon: GitBranch,
    title: 'Application Pipeline',
    shortTitle: 'Pipeline Tracking',
    description:
      'A visual Kanban board that moves your leads through every stage — from Saved to Offer — with drag-and-drop simplicity.',
    accent: 'text-muted',
  },
  {
    icon: Users,
    title: 'Recruiter CRM',
    shortTitle: 'Recruiter CRM',
    description:
      'Track every contact associated with a lead, log outreach, set follow-up reminders, and never let a warm connection go cold.',
    accent: 'text-success-text',
  },
  {
    icon: BookOpen,
    title: 'Weekly Review & Progress',
    shortTitle: 'Weekly Review',
    description:
      'Review real activity, completed tasks, and next actions to keep your search consistent and informed.',
    accent: 'text-muted',
  },
  {
    icon: LayoutDashboard,
    title: 'Unified Dashboard',
    shortTitle: 'Unified Dashboard',
    description:
      'One view for your streak, daily queue, top priorities, and upcoming milestones. Your search at a glance — nothing hidden.',
    accent: 'text-accent-text',
  },
];
