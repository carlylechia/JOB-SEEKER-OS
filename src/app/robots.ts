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
        '/admin',
        '/dashboard',
        '/jobs$',
        '/jobs/',
        '/queue',
        '/pipeline',
        '/studio',
        '/daily-jobs',
        '/contacts',
        '/prep',
        '/templates',
        '/profile',
        '/career-profile',
        '/resumes',
        '/application-materials',
        '/interview-prep',
        '/settings',
        '/onboarding',
        '/auth/',
      ],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}