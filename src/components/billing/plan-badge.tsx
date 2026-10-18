import type { PlanCode } from '@/lib/billing/plans';
import { getPlanLabel } from '@/lib/billing/plans';

/**
 * Compact plan badge. Uses text (not colour alone) so status is conveyed to
 * screen readers too.
 */
export function PlanBadge({
  plan,
  isTrialing,
  size = 'sm',
}: {
  plan: PlanCode;
  isTrialing?: boolean;
  size?: 'sm' | 'md';
}) {
  const label = getPlanLabel(plan, Boolean(isTrialing));

  const tone =
    plan === 'PREMIUM'
      ? 'bg-ink text-background'
      : plan === 'PRO'
        ? 'bg-accent/20 text-warn-text border border-accent/40'
        : 'bg-surface text-muted border border-line';

  const sizing = size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`badge ${tone} ${sizing}`}>
      <span className="sr-only">Current plan: </span>
      {label}
    </span>
  );
}

/** Neutral status pill for subscription states. */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    TRIALING: { label: 'Trial', className: 'bg-accent/15 text-warn-text border border-accent/35' },
    ACTIVE: { label: 'Active', className: 'bg-success/10 text-success-text border border-success/30' },
    EXPIRED: { label: 'Expired', className: 'bg-surface text-muted border border-line' },
    CANCELLED: { label: 'Cancelled', className: 'bg-surface text-muted border border-line' },
    SUSPENDED: { label: 'Suspended', className: 'bg-danger/10 text-danger-text border border-danger/30' },
    NONE: { label: 'Free', className: 'bg-surface text-muted border border-line' },
    PENDING: { label: 'Pending', className: 'bg-accent/15 text-warn-text border border-accent/35' },
    CONTACTED: { label: 'Contacted', className: 'bg-info/10 text-info-text border border-info/30' },
    APPROVED: { label: 'Approved', className: 'bg-success/10 text-success-text border border-success/30' },
    REJECTED: { label: 'Rejected', className: 'bg-danger/10 text-danger-text border border-danger/30' },
  };

  const entry = map[status] ?? { label: status, className: 'bg-surface text-muted border border-line' };

  return (
    <span className={`badge ${entry.className}`}>
      <span className="sr-only">Status: </span>
      {entry.label}
    </span>
  );
}