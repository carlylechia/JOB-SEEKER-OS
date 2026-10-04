import './globals.css';
import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'teChia Jobs — The AI-Powered Job Search Operating System',
    template: '%s · teChia Jobs',
  },
  description:
    'teChia Jobs helps job seekers discover relevant opportunities, organize applications, strengthen resumes, and build a smarter job search.',
  applicationName: 'teChia Jobs',
  authors: [{ name: 'teChia Digital Solutions' }],
  creator: 'teChia Digital Solutions',
  publisher: 'teChia Digital Solutions',
  openGraph: {
    type: 'website',
    siteName: 'teChia Jobs',
    title: 'teChia Jobs — The AI-Powered Job Search Operating System',
    description:
      'teChia Jobs helps job seekers discover relevant opportunities, organize applications, strengthen resumes, and build a smarter job search.',
    url: appUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'teChia Jobs — The AI-Powered Job Search Operating System',
    description:
      'teChia Jobs helps job seekers discover relevant opportunities, organize applications, strengthen resumes, and build a smarter job search.',
  },
  icons: {
    apple: '/apple-touch-icon.png',
    icon: '/icon.svg',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
