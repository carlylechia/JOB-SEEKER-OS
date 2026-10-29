'use client';

import { useParams } from 'next/navigation';
import { PackWorkspace } from '@/components/interview-prep/pack-workspace';

export default function InterviewPrepPackPage() {
  const params = useParams<{ packId: string }>();
  return <PackWorkspace packId={params.packId} />;
}
