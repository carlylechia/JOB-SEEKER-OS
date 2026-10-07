import type { NextConfig } from 'next';

/**
 * Production security headers.
 *
 * Tuned for the services this app ACTUALLY uses rather than a generic copied
 * CSP: Auth.js, LinkedIn OAuth, Vercel Analytics, Vercel Blob, Resend, and
 * Google Fonts (loaded locally by next/font, so `font-src` stays self-only).
 *
 * Notes:
 * - `frame-ancestors 'none'` plus `X-Frame-Options` prevents clickjacking.
 * - HSTS is set with preload; the header only has effect over HTTPS.
 * - No `unsafe-eval` in production.
 * - `connect-src` covers the browser-visible origins only; server-to-server
 *   calls (Resend, the database) are not browser requests.
 */
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; dev additionally needs eval for
  // React Fast Refresh.
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  // Tailwind and the design system use inline styles extensively.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://*.vercel-storage.com https://*.linkedin.com",
  "font-src 'self' data:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://www.linkedin.com",
  // Only origins the BROWSER talks to. Resend and Postgres are server-side.
  "connect-src 'self' https://*.linkedin.com https://*.analytics.com https://vitals.vercel-insights.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Geolocation/camera/microphone are unused by this product; payment and
    // USB are blocked by default. Clipboard is allowed for copy-to-clipboard UX.
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  // The app build typechecks with tests excluded; `npm run typecheck` uses
  // tsconfig.json and still covers the test suite. Keeps the production build
  // independent of test-only type packages.
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  experimental: {
    typedRoutes: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Private, per-user surfaces must never be cached by a CDN or browser.
      {
        source: '/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' }],
      },
      {
        source: '/settings/billing',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' }],
      },
      {
        source: '/api/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' }],
      },
      {
        source: '/api/billing/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' }],
      },
      {
        source: '/api/upgrade-requests',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;