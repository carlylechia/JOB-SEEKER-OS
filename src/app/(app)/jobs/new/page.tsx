'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { JobForm } from '@/components/jobs/job-form';
import { JobIngestionForm } from '@/components/jobs/job-ingestion-form';
import { PublicJobBrowser } from '@/components/jobs/public-job-browser';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { JobFormValues, JobIngestionResult } from '@/types';

type Tab = 'manual' | 'browse';

export default function NewJobPage() {
  const router = useRouter();
  const { createJob, titleOptions, createTitle } = useJobs();
  const [prefillValues, setPrefillValues] = useState<Partial<JobFormValues> | undefined>();
  const [ingestionResult, setIngestionResult] = useState<JobIngestionResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('manual');
  const resetToken = useMemo(() => JSON.stringify(prefillValues || {}), [prefillValues]);

  async function handleCreate(values: JobFormValues) {
    const job = await createJob(values);
    router.push(`/jobs/${job.id}`);
  }

  function handleApplyPrefill(prefill: Partial<JobFormValues>, result: JobIngestionResult) {
    setPrefillValues(prefill);
    setIngestionResult(result);
  }

  function handlePublicImport(jobId: string) {
    router.push(`/jobs/${jobId}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Job Lead"
        subtitle="Capture a role manually, ingest a posting URL, or import directly from the public jobs pool."
      />

      {/* Tab switcher */}
      <div className="flex gap-2 rounded-2xl border border-line p-1 w-fit">
        <button
          type="button"
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'manual'
              ? 'bg-white/10 text-ink'
              : 'text-muted hover:text-ink'
          }`}
          onClick={() => setActiveTab('manual')}
        >
          Add manually
        </button>
        <button
          type="button"
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'browse'
              ? 'bg-white/10 text-ink'
              : 'text-muted hover:text-ink'
          }`}
          onClick={() => setActiveTab('browse')}
        >
          Browse public jobs
        </button>
      </div>

      {activeTab === 'browse' ? (
        <div className="card-pad">
          <h3 className="mb-1 text-lg font-semibold">Public jobs pool</h3>
          <p className="mb-5 text-sm text-muted">
            Jobs contributed by the community. Click "Add to workspace" to instantly clone a role into your tracker with personalised scoring applied.
          </p>
          <PublicJobBrowser onImport={handlePublicImport} />
        </div>
      ) : (
        <>
          <JobIngestionForm onApply={handleApplyPrefill} />
          {ingestionResult ? (
            <div className="card-pad">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">Extracted preview</div>
              <p className="mt-3 text-sm leading-7 text-muted">
                Parser mode: {ingestionResult.sourceMode}. Review and edit the prefilled fields below before saving.
              </p>
            </div>
          ) : null}
          <JobForm
            mode="create"
            onSubmit={handleCreate}
            initialValues={prefillValues}
            resetToken={resetToken}
            titleOptions={titleOptions}
            onCreateTitle={createTitle}
          />
        </>
      )}
    </div>
  );
}

