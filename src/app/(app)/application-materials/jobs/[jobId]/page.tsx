import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import ApplicationKitWorkspace from '@/components/application-materials/application-kit-workspace';
import { requireUser } from '@/lib/authz';
import {
  ApplicationWorkspaceNotFoundError,
  loadApplicationWorkspace,
} from '@/lib/application-materials/workspace-server';

export const metadata: Metadata = {
  title: 'Application kit — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ jobId: string }> };

/**
 * One job's application kit.
 *
 * The loader is ownership-scoped before anything is rendered, so a job that
 * belongs to another user is a 404 identical to one that does not exist. The
 * client receives only bounded summaries; full material text stays behind the
 * per-material API and its own ownership check.
 */
export default async function ApplicationKitPage({ params }: Props) {
  const user = await requireUser();
  const { jobId } = await params;

  let workspace;
  try {
    workspace = await loadApplicationWorkspace({ userId: user.id, jobId });
  } catch (error) {
    if (error instanceof ApplicationWorkspaceNotFoundError) notFound();
    throw error;
  }

  return <ApplicationKitWorkspace initialWorkspace={workspace} />;
}
