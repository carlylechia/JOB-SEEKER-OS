import type { MetadataRoute } from 'next';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: appUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${appUrl}/jobs-public`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${appUrl}/demo`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${appUrl}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${appUrl}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
