import type { MetadataRoute } from 'next';
import { getAppUrl } from '@/lib/site-url';

const appUrl = getAppUrl();

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