import type { Prisma } from '@prisma/client';

export const ADMIN_USERS_PAGE_SIZE = 25;

export type AdminUserAccessFilter = 'all' | 'trial' | 'paid' | 'free';

export type AdminUserPlanFilter = 'FREE' | 'PRO' | 'PREMIUM' | 'NONE';

export type AdminUserSubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SUSPENDED'
  | 'NONE';

export type AdminUserSortKey = 'createdAt' | 'name' | 'email' | 'trialEndsAt';

export type AdminUserFilters = {
  q: string;
  role?: 'USER' | 'ADMIN';
  access: AdminUserAccessFilter;
  plan?: AdminUserPlanFilter;
  status?: AdminUserSubscriptionStatus;
  joinedFrom?: string;
  joinedTo?: string;
};

export type AdminUserFilterInput = {
  q?: string | null;
  role?: string | null;
  access?: string | null;
  plan?: string | null;
  status?: string | null;
  joinedFrom?: string | null;
  joinedTo?: string | null;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

function normalizeDateOnly(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !isValidDateOnly(trimmed)) return undefined;
  return trimmed;
}

/** Normalise the raw query-string / form values into validated filters. */
export function parseAdminUserFilters(input: AdminUserFilterInput): AdminUserFilters {
  const q = (input.q ?? '').trim().slice(0, 120);
  const role = input.role === 'USER' || input.role === 'ADMIN' ? input.role : undefined;
  const access = input.access === 'trial' || input.access === 'paid' || input.access === 'free' ? input.access : 'all';
  const plan = input.plan === 'FREE' || input.plan === 'PRO' || input.plan === 'PREMIUM' || input.plan === 'NONE'
    ? input.plan
    : undefined;
  const status = input.status === 'TRIALING' || input.status === 'ACTIVE' || input.status === 'EXPIRED' || input.status === 'CANCELLED' || input.status === 'SUSPENDED' || input.status === 'NONE'
    ? input.status
    : undefined;

  const joinedFrom = normalizeDateOnly(input.joinedFrom);
  const joinedTo = normalizeDateOnly(input.joinedTo);
  const from = joinedFrom ? new Date(`${joinedFrom}T00:00:00.000Z`) : undefined;
  const to = joinedTo ? new Date(`${joinedTo}T00:00:00.000Z`) : undefined;

  return {
    q,
    role,
    access,
    plan,
    status,
    joinedFrom: from && !Number.isNaN(from.getTime()) ? joinedFrom : undefined,
    joinedTo: to && !Number.isNaN(to.getTime()) ? joinedTo : undefined,
  };
}

function startOfUtcDate(value: string): Date | undefined {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Build the server-side Prisma user filter from normalised filters.
 *
 * All user-owned relations cascade on delete, so the DB rows are removed
 * together when this delete runs — the admin user deletion route relies on it.
 */
export function buildAdminUserWhere(filters: AdminUserFilters): Prisma.UserWhereInput {
  const conditions: Prisma.UserWhereInput[] = [];

  if (filters.q) {
    conditions.push({
      OR: [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { email: { contains: filters.q, mode: 'insensitive' } },
      ],
    });
  }

  if (filters.role) conditions.push({ role: filters.role });

  if (filters.joinedFrom) {
    const fromDate = startOfUtcDate(filters.joinedFrom);
    conditions.push({
      createdAt: { gte: fromDate ?? new Date('1970-01-01T00:00:00.000Z') },
    });
  }
  if (filters.joinedTo) {
    const toDate = startOfUtcDate(filters.joinedTo) ?? new Date('1970-01-01T00:00:00.000Z');
    conditions.push({ createdAt: { lt: new Date(toDate.getTime() + 24 * 60 * 60 * 1000) } });
  }

  if (filters.plan === 'NONE' || filters.status === 'NONE') {
    conditions.push({ subscription: null });
  } else {
    const subscription: Prisma.SubscriptionWhereInput = {};
    let requiresSubscription = false;

    if (filters.status) {
      subscription.status = filters.status;
      requiresSubscription = true;
    }
    if (filters.plan) {
      subscription.plan = { code: filters.plan };
      requiresSubscription = true;
    }
    if (filters.access === 'trial') {
      subscription.status = 'TRIALING';
      requiresSubscription = true;
    } else if (filters.access === 'paid') {
      subscription.status = 'ACTIVE';
      subscription.plan = { code: { in: ['PRO', 'PREMIUM'] } };
      requiresSubscription = true;
    } else if (filters.access === 'free') {
      subscription.status = 'ACTIVE';
      subscription.plan = { code: 'FREE' };
      requiresSubscription = true;
    }

    if (requiresSubscription) conditions.push({ subscription: { is: subscription } });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}
