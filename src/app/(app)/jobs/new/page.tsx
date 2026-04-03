'use client';

import { useRouter } from 'next/navigation';
import { JobForm } from '@/components/jobs/job-form';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { JobFormValues } from '@/types';

export default function NewJobPage() {
  const router = useRouter();
  const { createJob } = useJobs();

  async function handleCreate(values: JobFormValues) {
    const job = await createJob(values);
    router.push(`/jobs/${job.id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Add Job Lead" subtitle="Create a new lead, score the fit, and save it into your workspace." />
      <JobForm mode="create" onSubmit={handleCreate} />
    </div>
  );
}
