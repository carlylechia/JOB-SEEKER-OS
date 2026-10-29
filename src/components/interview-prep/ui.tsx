import Link from 'next/link';
import { ExternalLink, Info } from 'lucide-react';
import type {
  CompanyClaimBasis,
  EvidenceStatus,
  Priority,
  ResearchSource,
} from './types';

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="muted mt-1 max-w-3xl">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`card-pad ${className}`}>{children}</div>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface-sunken/40 px-6 py-10 text-center">
      <Info className="mx-auto h-5 w-5 text-muted" aria-hidden />
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      <p className="muted mx-auto mt-1 max-w-xl">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'accent';
  title?: string;
}) {
  const styles: Record<string, string> = {
    neutral: 'bg-surface-sunken text-muted',
    success: 'bg-success/15 text-success-text',
    warn: 'bg-warn/15 text-warn-text',
    danger: 'bg-danger/15 text-danger-text',
    info: 'bg-[rgb(var(--info-text)/0.15)] text-info-text',
    accent: 'bg-accent/15 text-accent-text',
  };
  return (
    <span className={`badge ${styles[tone]}`} title={title}>
      {children}
    </span>
  );
}

export function BasisPill({ basis }: { basis: CompanyClaimBasis | string }) {
  if (basis === 'SOURCE') {
    return <Pill tone="success">Source-backed</Pill>;
  }
  return <Pill tone="warn">Inference — confirm</Pill>;
}

export function PriorityPill({ priority }: { priority: Priority | string }) {
  const tone = priority === 'HIGH' ? 'danger' : priority === 'MEDIUM' ? 'warn' : 'neutral';
  return <Pill tone={tone}>{priority === 'HIGH' ? 'High priority' : priority === 'MEDIUM' ? 'Medium' : 'Low'}</Pill>;
}

const EVIDENCE_TONE: Record<EvidenceStatus, 'success' | 'info' | 'warn' | 'danger'> = {
  DEMONSTRATED: 'success',
  TRANSFERABLE: 'info',
  UNCLEAR: 'warn',
  NO_EVIDENCE_FOUND: 'danger',
};

const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  DEMONSTRATED: 'Demonstrated',
  TRANSFERABLE: 'Transferable',
  UNCLEAR: 'Unclear',
  NO_EVIDENCE_FOUND: 'No evidence found',
};

export function EvidencePill({ status }: { status: EvidenceStatus }) {
  return <Pill tone={EVIDENCE_TONE[status]}>{EVIDENCE_LABEL[status]}</Pill>;
}

export function SourceRefs({
  indexes,
  sources,
}: {
  indexes: number[];
  sources: ResearchSource[];
}) {
  if (indexes.length === 0) {
    return <span className="text-xs text-muted">No source cited</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {indexes.map((index) => {
        const source = sources[index];
        if (!source) {
          return (
            <span key={index} className="badge bg-surface-sunken text-muted">
              Source {index + 1}
            </span>
          );
        }
        const label = `Source ${index + 1}: ${source.title}`;
        return source.url ? (
          <a
            key={index}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="badge bg-surface-sunken text-muted hover:text-ink"
            title={label}
          >
            S{index + 1}
            <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
          </a>
        ) : (
          <span key={index} className="badge bg-surface-sunken text-muted" title={label}>
            S{index + 1}
          </span>
        );
      })}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warn' | 'danger';
}) {
  const border =
    tone === 'success'
      ? 'border-success/25'
      : tone === 'warn'
        ? 'border-warn/25'
        : tone === 'danger'
          ? 'border-danger/25'
          : 'border-line';
  return (
    <div className={`rounded-xl border ${border} bg-surface-sunken/40 p-3`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Bullets({ items, className = '' }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={`list-disc space-y-1 pl-5 text-sm ${className}`}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent" href={href}>
      {children}
    </Link>
  );
}

export function formatLongDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatShortDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
