'use client';

import {
  BarChart3,
  Building2,
  Code2,
  Layers,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';
import {
  INTERVIEW_CONTEXT_DESCRIPTIONS,
  INTERVIEW_CONTEXT_LABELS,
  INTERVIEW_TRACK_CONTEXTS,
  INTERVIEW_TRACK_DESCRIPTIONS,
  INTERVIEW_TRACK_LABELS,
  interviewTrackForContext,
  primaryContextForTrack,
  type InterviewContext,
  type InterviewTrack,
} from '@/lib/interview-prep/schema';
import { Pill } from './ui';

const TRACK_ICONS: Record<InterviewTrack, LucideIcon> = {
  BEHAVIORAL: MessageSquareText,
  TECHNICAL: Code2,
  CASE_STUDY: BarChart3,
  ROLE_AND_COMPANY: Building2,
  MIXED: Layers,
};

const TRACKS = Object.keys(INTERVIEW_TRACK_LABELS) as InterviewTrack[];

/**
 * Two-level interview type choice: the track is the mental model, the context
 * is the precise format used for generation. Selecting a track immediately
 * picks its most representative context so the form always stays valid.
 */
export function InterviewTypePicker({
  value,
  onChange,
  idPrefix = 'interview-type',
  disabled = false,
}: {
  value: InterviewContext;
  onChange: (context: InterviewContext) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const selectedTrack = interviewTrackForContext(value);
  const contexts = INTERVIEW_TRACK_CONTEXTS[selectedTrack];

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Interview type" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {TRACKS.map((track) => {
          const Icon = TRACK_ICONS[track];
          const selected = track === selectedTrack;
          return (
            <button
              key={track}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                if (selected) return;
                onChange(primaryContextForTrack(track));
              }}
              className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? 'border-accent bg-accent/[0.07] ring-1 ring-accent/30'
                  : 'border-line bg-card hover:bg-surface-sunken'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                    selected ? 'bg-accent/15 text-accent-text' : 'bg-surface-sunken text-muted'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="text-sm font-medium text-ink">{INTERVIEW_TRACK_LABELS[track]}</span>
              </span>
              <span className="muted mt-2 block text-xs leading-5">
                {INTERVIEW_TRACK_DESCRIPTIONS[track]}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${idPrefix}-context`}>
          Specific format
        </label>
        <select
          id={`${idPrefix}-context`}
          className="input"
          value={value}
          onChange={(event) => onChange(event.target.value as InterviewContext)}
          disabled={disabled}
        >
          {contexts.map((context) => (
            <option key={context} value={context}>
              {INTERVIEW_CONTEXT_LABELS[context]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">{INTERVIEW_CONTEXT_DESCRIPTIONS[value]}</p>
      </div>
    </div>
  );
}

/** Compact type label for cards, headers and tab introductions. */
export function InterviewTypeBadge({
  context,
  showContext = false,
}: {
  context: InterviewContext;
  showContext?: boolean;
}) {
  const track = interviewTrackForContext(context);
  const Icon = TRACK_ICONS[track];
  return (
    <Pill tone="accent" title={INTERVIEW_TRACK_DESCRIPTIONS[track]}>
      <Icon className="mr-1 inline h-3 w-3" aria-hidden />
      {INTERVIEW_TRACK_LABELS[track]}
      {showContext ? ` · ${INTERVIEW_CONTEXT_LABELS[context]}` : ''}
    </Pill>
  );
}

/** Fuller explanation used on the briefing and mock tabs. */
export function InterviewTypeSummary({
  context,
  className = '',
}: {
  context: InterviewContext;
  className?: string;
}) {
  const track = interviewTrackForContext(context);
  const Icon = TRACK_ICONS[track];
  return (
    <div className={`rounded-xl border border-accent/25 bg-accent/[0.05] p-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon className="h-4 w-4 text-accent-text" aria-hidden />
          {INTERVIEW_TRACK_LABELS[track]} interview
        </p>
        <span className="badge bg-card text-muted">{INTERVIEW_CONTEXT_LABELS[context]}</span>
      </div>
      <p className="muted mt-1 text-xs leading-5">{INTERVIEW_TRACK_DESCRIPTIONS[track]}</p>
      <p className="mt-1 text-[11px] text-muted">
        Questions, coaching and evaluations in this pack are tailored to this format.
      </p>
    </div>
  );
}
