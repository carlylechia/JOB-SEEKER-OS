import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { JobLead } from '@/types';

const TIER_CONFIG: Record<string, { label: string; bar: string; badge: string }> = {
  A: { label: 'Strong Fit', bar: 'bg-emerald-400', badge: 'bg-emerald-500/20 text-emerald-700 border-emerald-500/30' },
  B: { label: 'Good Fit',   bar: 'bg-[#D4AF37]',    badge: 'bg-[#D4AF37]/20 text-[#8A6D1F] border-[#D4AF37]/30'         },
  C: { label: 'Moderate',   bar: 'bg-amber-400',   badge: 'bg-amber-500/20 text-amber-800 border-amber-500/30'      },
  D: { label: 'Stretch',    bar: 'bg-[#C9CED6]',   badge: 'bg-[#686F7B]/15 text-[#4A505A] border-[#C9CED6]'      },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  APPLY_TODAY:      { label: 'Apply today',       color: 'text-rose-300'    },
  APPLY_THIS_WEEK:  { label: 'Apply this week',   color: 'text-amber-800'   },
  FOLLOW_UP_DUE:    { label: 'Follow-up due',     color: 'text-orange-300'  },
  INTERVIEW_SOON:   { label: 'Interview soon',    color: 'text-[#5B6472]'  },
  PREPARE_ASSETS:   { label: 'Prepare assets',    color: 'text-[#8A6D1F]'     },
  MONITOR:          { label: 'Monitor',           color: 'text-[#686F7B]'   },
};

export function TopPriorityList({ jobs }: { jobs: JobLead[] }) {
  if (!jobs.length) return null;

  return (
    <div className="card-pad">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">Top priority roles</h3>
          <p className="mt-0.5 text-xs text-muted">Your best current opportunities — ranked by fit + urgency</p>
        </div>
        <Link href="/jobs" className="inline-flex items-center gap-1 text-xs text-[#8A6D1F] hover:opacity-80 transition-opacity">
          All jobs <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-2.5">
        {jobs.map((job) => {
          const tier = TIER_CONFIG[job.score.fitTier] ?? TIER_CONFIG.C;
          const priority = PRIORITY_CONFIG[job.priorityFlag];
          const scoreWidth = `${Math.max(4, job.score.fitScore)}%`;

          return (
            <Link
              href={`/jobs/${job.id}`}
              key={job.id}
              className="group flex items-center gap-4 rounded-xl border border-[#E2E5EA] bg-black/[0.03] p-4 transition-all hover:border-[#DFE3E9] hover:bg-black/[0.05]"
            >
              {/* Score ring */}
              <div className="flex-shrink-0 text-center">
                <div className={`text-xl font-bold leading-none ${tier.bar.replace('bg-', 'text-')}`}>
                  {job.score.fitScore}
                </div>
                <div className="mt-0.5 text-[9px] text-[#686F7B] uppercase tracking-wide">score</div>
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-semibold text-ink truncate">{job.title}</span>
                  {priority && (
                    <span className={`flex-shrink-0 text-[10px] font-medium ${priority.color}`}>
                      · {priority.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">{job.company}</span>
                  {job.location && <span className="text-xs text-[#8A919C]">{job.location}</span>}
                </div>
                {/* Score bar */}
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-black/[0.04]">
                  <div className={`h-full rounded-full transition-all duration-500 ${tier.bar}`} style={{ width: scoreWidth }} />
                </div>
              </div>

              {/* Tier badge + arrow */}
              <div className="flex-shrink-0 flex items-center gap-3">
                <span className={`hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tier.badge}`}>
                  {tier.label}
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[#8A919C] opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
