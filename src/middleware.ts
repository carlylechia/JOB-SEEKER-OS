import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Minimal middleware: forwards the current pathname as a request header so
 * Server Components (e.g. the (app) layout) can read it without importing
 * `next/headers` in an edge-incompatible way.
 *
 * THIS FILE PERFORMS NO AUTHORIZATION — BY DESIGN.
 *
 * Middleware runs in the Edge runtime and cannot reach Prisma or the Node
 * crypto/secret APIs, so it cannot verify a session or read a user's role. It
 * is therefore deliberately NOT used as an auth boundary.
 *
 * Authorization is enforced where the identity actually exists:
 *   - `src/app/(app)/layout.tsx`  → requires a session
 *   - `src/app/admin/layout.tsx`   → `requireAdmin()` on the server
 *   - every `/api/admin/*` route   → `getCurrentAdmin()` on the server
 *   - every admin mutation         → role re-verified inside the transaction
 *
 * A middleware-only "admin" check would create a false sense of security: it
 * could be bypassed and would not protect the API routes, which is where the
 * actual data lives.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('x-pathname', request.nextUrl.pathname);
  return response;
}

export const config = {
  // Run on all routes except Next.js internals and static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
