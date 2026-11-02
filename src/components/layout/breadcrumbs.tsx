import Link from 'next/link';

export type BreadcrumbItem = {
  label: string;
  /** Omit for the current (last) crumb. */
  href?: string;
};

type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  /** Optional root crumb rendered before the first item. Defaults to the admin area. */
  homeLabel?: string;
  homeHref?: string;
};

/**
 * Server-rendered breadcrumb trail. Plain links only — no client state, so it
 * can live in layouts and pages without hydration.
 */
export function Breadcrumbs({ items, homeLabel = 'Admin', homeHref = '/admin' }: BreadcrumbsProps) {
  const crumbs = [{ label: homeLabel, href: homeHref }, ...items];

  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const crumbHref = crumb.href && !isLast ? crumb.href : undefined;
          return (
            <li key={crumb.label} className="flex items-center gap-1.5">
              {index > 0 ? <span aria-hidden="true" className="text-ink-2/60">/</span> : null}
              {crumbHref ? (
                <Link href={crumbHref} className="hover:text-ink">
                  {crumb.label}
                </Link>
              ) : (
                <span className={isLast ? 'font-medium text-ink' : 'text-ink-2'}>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
