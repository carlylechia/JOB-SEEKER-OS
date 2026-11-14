import { redirect } from 'next/navigation';

/**
 * Legacy queue route.
 *
 * The dashboard renders the same persisted queue (`/api/career-actions`) and is
 * the single daily-action surface. The queue engine and its API are unchanged;
 * only the duplicate page is retired. A server redirect keeps every old link,
 * notification and digest working.
 */
export default function QueueLegacyPage() {
  redirect('/dashboard#daily-queue');
}
