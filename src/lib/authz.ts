/**
 * Server-side authorization primitives.
 *
 * Admin status is NEVER derived from a client-supplied flag, a hidden nav
 * item, or a hardcoded email in browser JavaScript. Every admin surface —
 * page, server action, route handler, data loader — must call into this module.
 *
 * Authorization is always re-read from the database, never from stale JWT
 * claims, so a revoked role takes effect immediately.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { logImportantInfo } from '@/lib/observability';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
};

/**
 * Resolve the authenticated user from the session, reading `role` fresh from
 * the database. Returns null when unauthenticated.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  // Stale JWT: the account was deleted while the token was still valid.
  if (!user) return null;

  return user;
}

/**
 * Get the current user or throw/redirect. Use in server components and loaders.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Resolve the current ADMIN, or null.
 *
 * Used by route handlers and server actions that must return a 401/403 rather
 * than redirect.
 */
export async function getCurrentAdmin(): Promise<AuthenticatedUser | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') return null;
  return user;
}

/**
 * Guard for admin server components / loaders: redirects ordinary users away
 * from `/admin`. Never leak whether a specific admin resource exists.
 */
export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();

  if (!user) redirect('/login');

  if (user.role !== 'ADMIN') {
    await logImportantInfo({
      event: 'admin_access_denied',
      userId: user.id,
      context: { reason: 'insufficient_role' },
    });
    redirect('/dashboard');
  }

  return user;
}

export function isAdmin(user: { role: string } | null | undefined): boolean {
  return user?.role === 'ADMIN';
}