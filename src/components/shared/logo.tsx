import Link from 'next/link';

export function Logo({ compact = false, href = '/' }: { compact?: boolean; href?: string }) {
  const mark = (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white shadow-soft">
      JS
    </span>
  );

  if (compact) {
    return <Link href={href} className="inline-flex items-center gap-3">{mark}</Link>;
  }

  return (
    <Link href={href} className="inline-flex items-center gap-3">
      {mark}
      <span>
        <span className="block text-lg font-semibold">Job Seeker OS</span>
        <span className="block text-xs text-muted">Personalized job search operating system</span>
      </span>
    </Link>
  );
}
