import Link from 'next/link';

type PaginationProps = {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
  label?: string;
};

function pageItems(current: number, totalPages: number): Array<number | 'ellipsis'> {
  const start = Math.max(1, Math.min(current - 2, totalPages - 4));
  const end = Math.min(totalPages, Math.max(current + 2, start + 4));

  const items: Array<number | 'ellipsis'> = [];
  if (start > 1) items.push('ellipsis');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages) items.push('ellipsis', end + 1);
  return items;
}

/**
 * Server-side numbered pagination. The caller supplies the href builder so the
 * component stays fully server-rendered and can preserve query-string filters.
 */
export function Pagination({ page, totalPages, hrefForPage, label = 'Pagination' }: PaginationProps) {
  if (totalPages <= 1) return null;

  const clamped = Math.max(1, Math.min(page, totalPages));
  const items = pageItems(clamped, totalPages);

  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3">
      {clamped > 1 ? (
        <Link href={hrefForPage(clamped - 1)} className="btn-secondary text-xs">
          Previous
        </Link>
      ) : (
        <span />
      )}

      <ol className="flex items-center gap-1.5">
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            <li key={`ellipsis-${index}`} className="px-1 text-muted" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefForPage(item)}
                aria-current={item === clamped ? 'page' : undefined}
                className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-medium ${
                  item === clamped
                    ? 'bg-accent/15 text-accent-text'
                    : 'text-ink-2 hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                {item}
              </Link>
            </li>
          ),
        )}
      </ol>

      {clamped < totalPages ? (
        <Link href={hrefForPage(clamped + 1)} className="btn-secondary text-xs">
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
