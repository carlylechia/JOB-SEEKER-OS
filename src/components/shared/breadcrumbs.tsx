'use client';

/**
 * Breadcrumbs.
 *
 * Derived from the current pathname so every page gets them without each one
 * having to declare its trail. Known segments get friendly labels; dynamic ids
 * (cuid-like) are replaced with a context-aware label based on the segment
 * before them, so `/jobs/cxxxx` reads as “Job details” rather than a hash.
 *
 * The component is intentionally presentational: it never fetches, so it cannot
 * block or flash while a page loads.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Overview',
  jobs: 'Find Jobs',
  'jobs-public': 'Public Jobs',
  pipeline: 'Applications',
  studio: 'Application Studio',
  settings: 'Settings',
  admin: 'Admin',
  queue: 'Daily Queue',
  'daily-jobs': 'Daily Top 5',
  contacts: 'Contacts',
  'interview-prep': 'Interview Prep',
  prep: 'Prep Notes',
  profile: 'Profile',
  'career-profile': 'Career Profile',
  resumes: 'Resumes',
  'application-materials': 'Application Materials',
  'application-studio': 'Application Studio',
  billing: 'Billing',
  onboarding: 'Onboarding',
  new: 'New',
  edit: 'Edit',
  checklist: 'Checklist',
  intelligence: 'Job Intelligence',
  rescore: 'Re-score',
  followup: 'Follow-up',
  status: 'Status',
  attempt: 'Attempt',
  application: 'Application',
  preparation: 'Preparation',
  runs: 'Runs',
  advance: 'Advance',
};

const DYNAMIC_LABELS: Record<string, string> = {
  jobs: 'Job details',
  resumes: 'Resume',
  'application-materials': 'Material',
  'interview-prep': 'Prep pack',
  runs: 'Run',
};

function isDynamicSegment(segment: string): boolean {
  // cuids and other opaque ids: long, no spaces, not a known label.
  return segment.length >= 12 && !SEGMENT_LABELS[segment];
}

export function Breadcrumbs({ className = '' }: { className?: string }) {
  const pathname = usePathname() ?? '';
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const previous = index > 0 ? segments[index - 1] : '';
    let label = SEGMENT_LABELS[segment];
    if (!label && isDynamicSegment(segment)) {
      label = DYNAMIC_LABELS[previous] ?? 'Details';
    }
    if (!label) {
      label = segment
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }
    return { label, href, isLast: index === segments.length - 1 };
  });

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1.5 text-xs text-muted ${className}`}>
      <Link href="/dashboard" className="inline-flex items-center gap-1 hover:text-ink transition-colors">
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Home</span>
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="inline-flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-muted/60" aria-hidden="true" />
          {crumb.isLast ? (
            <span className="font-medium text-ink" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <Link href={crumb.href} className="hover:text-ink transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
