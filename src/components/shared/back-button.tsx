'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/**
 * Browser-history back with a safe destination when there is no entry to
 * return to (direct links, new tabs, bookmarks).
 */
export function BackButton({
  fallbackHref = '/',
  label = 'Go back',
  className = 'btn-secondary',
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    // `history.length` includes the current entry. One or fewer means there
    // is nothing meaningful to go back to.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button type="button" onClick={goBack} className={className}>
      <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
