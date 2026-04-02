import Link from 'next/link';

export function Logo({ compact = false, href = '/' }: { compact?: boolean; href?: string }) {
  const mark = (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white shadow-soft">
      JS
    </span>
  );

  if (compact) {
    return (
      <Link href={href} className="inline-flex flex-col items-center gap-1">
        <img src="/logo-full.png" alt="full logo" className="h-12 w-auto" />
      </Link>
    );
  }

  return (
    <Link href={href} className="inline-flex flex-col items-center gap-2">
      <img src="/logo-full.png" alt="full logo" className="h-12 w-auto" />
      <span className="text-xs text-gray-600 text-center max-w-48">
        A personalized operating system for modern job seekers
      </span>
    </Link>
  );
}
