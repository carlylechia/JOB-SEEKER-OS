import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { getAppUrl } from '@/lib/site-url';
import { ThemeProvider, themeInitScript } from '@/components/shared/theme-provider';

const appUrl = getAppUrl();

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAF7' },
    { media: '(prefers-color-scheme: dark)', color: '#08111f' },
  ],
};

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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored/system theme before first paint so there is no
            flash of the wrong palette. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
