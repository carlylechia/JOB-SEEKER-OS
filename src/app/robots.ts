import type { MetadataRoute } from 'next';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/jobs-public', '/login', '/register'],
      // Private, authenticated surfaces. `/jobs$` is anchored so the public
      // `/jobs-public` route stays crawlable.
      disallow: [
        '/api/',
        '/dashboard',
        '/jobs$',
        '/jobs/',
        '/queue',
        '/pipeline',
        '/contacts',
        '/prep',
        '/templates',
        '/profile',
        '/settings',
        '/onboarding',
        '/auth/',
      ],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}