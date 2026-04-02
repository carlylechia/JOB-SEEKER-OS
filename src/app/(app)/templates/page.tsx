'use client';

import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function TemplatesPage() {
  const { templates, isLoading } = useJobs();
  if (isLoading) return <div className="card-pad">Loading templates…</div>;
  return (
    <div className="space-y-6">
      <PageHeader title="Follow-Up Templates" subtitle="Reusable templates for outreach, follow-ups, and thank-you notes." />
      <div className="grid gap-4 xl:grid-cols-[0.35fr_0.65fr]">
        <div className="card-pad">
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="rounded-xl border border-line p-3">
                <div className="font-medium">{template.name}</div>
                <div className="muted">{template.type.replaceAll('_', ' ')}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card-pad">
          <h3 className="text-lg font-semibold">Template preview</h3>
          {templates[0] ? (
            <div className="mt-4 space-y-4">
              <div>
                <div className="muted">Subject</div>
                <div>{templates[0].subject}</div>
              </div>
              <div>
                <div className="muted">Body</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{templates[0].body}</pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
