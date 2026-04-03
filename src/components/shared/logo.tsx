import Link from 'next/link';

type LogoProps = {
  compact?: boolean;
  href?: string;
  showSubtitle?: boolean;
  centered?: boolean;
};

export function Logo({
  compact = false,
  href = '/',
  showSubtitle = false,
  centered = false,
}: LogoProps) {
  if (compact) {
    return (
      <Link
        href={href}
        className={`inline-flex items-center justify-center ${centered ? 'mx-auto' : ''}`}
      >
        <img
          src="/logo-full.png"
          alt="Job Seeker OS"
          className="h-8 w-auto rounded-xl"
        />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`inline-flex flex-col items-center gap-2 ${centered ? 'mx-auto' : ''}`}
    >
      <img src="/logo-full.png" alt="Job Seeker OS" className="h-12 w-auto" />
      {showSubtitle ? (
        <span className="hidden max-w-48 text-center text-xs text-gray-600 md:block">
          A personalized operating system for modern job seekers
        </span>
      ) : null}
    </Link>
  );
}