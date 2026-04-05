'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { JobForm } from '@/components/jobs/job-form';
import { JobIngestionForm } from '@/components/jobs/job-ingestion-form';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { JobFormValues, JobIngestionResult } from '@/types';

export default function NewJobPage() {
  const router = useRouter();
  const { createJob, titleOptions, createTitle } = useJobs();
  const [prefillValues, setPrefillValues] = useState<Partial<JobFormValues> | undefined>();
  const [ingestionResult, setIngestionResult] = useState<JobIngestionResult | null>(null);
  const resetToken = useMemo(() => JSON.stringify(prefillValues || {}), [prefillValues]);

  async function handleCreate(values: JobFormValues) {
    const job = await createJob(values);
    router.push(`/jobs/${job.id}`);
  }

  function handleApplyPrefill(prefill: Partial<JobFormValues>, result: JobIngestionResult) {
    setPrefillValues(prefill);
    setIngestionResult(result);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Add Job Lead" subtitle="Capture a role manually or ingest a posting, review the extracted fields, then save it into your private workspace." />
      <JobIngestionForm onApply={handleApplyPrefill} />
      {ingestionResult ? (
        <div className="card-pad">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">Extracted preview</div>
          <p className="mt-3 text-sm leading-7 text-muted">Parser mode: {ingestionResult.sourceMode}. Review and edit the prefilled fields below before saving. URLs can still be imperfect, so this page always keeps you in control before anything is stored.</p>
        </div>
      ) : null}
      <JobForm mode="create" onSubmit={handleCreate} initialValues={prefillValues} resetToken={resetToken} titleOptions={titleOptions} onCreateTitle={createTitle} />
    </div>
  );
}
