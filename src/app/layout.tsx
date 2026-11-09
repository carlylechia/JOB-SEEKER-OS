import './globals.css';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Analytics } from '@vercel/analytics/next';
import { getAppUrl } from '@/lib/site-url';
import { ThemeProvider, themeInitScript } from '@/components/shared/theme-provider';

const appUrl = getAppUrl();

/**
 * Body type: Inter, self-hosted from the repository.
 *
 * It is exceptionally legible at the small sizes this product uses for tables,
 * forms, filters and dense navigation, and it is already bundled for the resume
 * preview. Keeping it local means no runtime Google Fonts request and no layout
 * shift on slow connections.
 */
const bodyFont = localFont({
  src: [
    { path: './fonts/inter-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/inter-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
});

/**
 * Display type: Fraunces (variable, SOFT axis).
 *
 * Its gently curved serifs and soft terminals give headings and brand moments
 * personality without turning forms or tables into a costume. It is only used
 * for h1/h2-level statements and the brand wordmark; body copy stays on Inter.
 */
const displayFont = localFont({
  src: [{ path: './fonts/fraunces-latin-soft-normal.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8F3' },
    { media: '(prefers-color-scheme: dark)', color: '#191D1B' },
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
    // `overflow-x-clip` contains stray horizontal content without turning the
    // document into a scroll container, which would break sticky descendants.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bodyFont.variable} ${displayFont.variable} w-full overflow-x-hidden`}
    >
      <head>
        {/* Applies the stored/system theme before first paint so there is no
            flash of the wrong palette. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning className={`${bodyFont.className} w-full overflow-x-hidden`}>
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
