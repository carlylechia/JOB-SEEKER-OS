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
  description: string;
  accent: string;
  border: string;
};

/**
 * Shared feature catalogue for the hero track and the full feature section.
 *
 * Keeping this out of the client component means the mobile hero can render the
 * compact track on the server while the full section below remains a showcase.
 */
export const FEATURE_SHOWCASE: FeatureShowcaseItem[] = [
  {
    icon: Search,
    title: 'Daily Top 5 Job Discovery',
    description:
      'Receive a focused, personalized shortlist of relevant opportunities with fit signals and links to official application pages.',
    accent: 'text-accent-text',
    border: 'hover:border-accent/30',
  },
  {
    icon: Star,
    title: 'AI Fit Scoring',
    description:
      'Every job receives a fit score based on your preferences — stack, seniority, location, and remote priorities — so you know exactly what to focus on.',
    accent: 'text-warn-text',
    border: 'hover:border-warn/30',
  },
  {
    icon: Brain,
    title: 'AI Job Intelligence',
    description:
      'Understand why a job fits, which requirements need attention, and what to do next, with evidence-backed explanations that never override hard eligibility rules.',
    accent: 'text-accent-text',
    border: 'hover:border-accent/30',
  },
  {
    icon: FileText,
    title: 'Resume Intelligence',
    description:
      'Upload a resume and build a structured, reviewable career profile that powers matching, tailoring, and application materials.',
    accent: 'text-muted',
    border: 'hover:border-line-strong',
  },
  {
    icon: FileText,
    title: 'Resume Builder & Optimization',
    description:
      'Build structured resumes, create role-specific variants, and apply evidence-backed suggestions without inventing experience.',
    accent: 'text-success-text',
    border: 'hover:border-success/30',
  },
  {
    icon: FileText,
    title: 'AI Application Materials',
    description:
      'Draft cover letters, recruiter outreach, and follow-ups from your real profile and job details, then review and edit before use.',
    accent: 'text-danger-text',
    border: 'hover:border-danger/30',
  },
  {
    icon: Calendar,
    title: 'Interview Preparation',
    description:
      'Generate role-specific preparation packs, structure answers, and practise with feedback linked to the correct job.',
    accent: 'text-muted',
    border: 'hover:border-line-strong',
  },
  {
    icon: ListChecks,
    title: 'Daily Smart Queue',
    description:
      'A curated, ranked list of jobs and actions that need your attention today, including follow-ups and stale leads.',
    accent: 'text-accent-text',
    border: 'hover:border-accent/30',
  },
  {
    icon: GitBranch,
    title: 'Application Pipeline',
    description:
      'A visual Kanban board that moves your leads through every stage — from Saved to Offer — with drag-and-drop simplicity.',
    accent: 'text-muted',
    border: 'hover:border-line-strong',
  },
  {
    icon: Users,
    title: 'Recruiter CRM',
    description:
      'Track every contact associated with a lead, log outreach, set follow-up reminders, and never let a warm connection go cold.',
    accent: 'text-success-text',
    border: 'hover:border-success/30',
  },
  {
    icon: BookOpen,
    title: 'Weekly Review & Progress',
    description:
      'Review real activity, completed tasks, and next actions to keep your search consistent and informed.',
    accent: 'text-muted',
    border: 'hover:border-line-strong',
  },
  {
    icon: LayoutDashboard,
    title: 'Unified Dashboard',
    description:
      'One view for your streak, daily queue, top priorities, and upcoming milestones. Your search at a glance — nothing hidden.',
    accent: 'text-accent-text',
    border: 'hover:border-accent/30',
  },
];

// Keep the hero compact: the eight capabilities that make up the core loop.
export const HERO_FEATURES = FEATURE_SHOWCASE.slice(0, 8);
