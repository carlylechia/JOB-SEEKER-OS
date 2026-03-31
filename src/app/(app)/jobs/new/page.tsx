'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { useState } from 'react';
import { useJobs } from '@/hooks/use-job-data';
import { JobLead } from '@/types';

export default function NewJobPage() {
  const router = useRouter();
  const { upsertJob } = useJobs();
  const [form, setForm] = useState({ company: '', title: '', source: '', jobUrl: '', location: 'Remote', remoteType: 'Remote', timezoneRequirement: 'US overlap', eligibilityRegion: 'Worldwide', salaryMin: '2500', salaryMax: '3500', notes: '' });

  function submit() {
    const job: JobLead = {
      id: crypto.randomUUID(),
      company: form.company,
      title: form.title,
      source: form.source,
      jobUrl: form.jobUrl,
      location: form.location,
      remoteType: form.remoteType,
      timezoneRequirement: form.timezoneRequirement,
      eligibilityRegion: form.eligibilityRegion,
      salaryMin: Number(form.salaryMin),
      salaryMax: Number(form.salaryMax),
      currency: 'USD',
      notes: form.notes,
      status: 'LEAD',
      dateFound: new Date().toISOString().slice(0,10),
      priorityFlag: 'MONITOR',
      score: { coreStackMatch: 4, roleAlignment: 4, seniorityFit: 4, geographyEligibility: 5, timezoneCompatibility: 4, compensationFit: 4, domainRelevance: 3, applicationFriction: 3, signalQuality: 4, fitScore: 0, fitTier: 'B' },
      checklist: { resumeTailored: false, pdfChecked: false, coverLetterReady: false, portfolioAdded: false, videoDone: false, compensationChecked: false, eligibilityChecked: false, submitted: false },
      contacts: [],
      interviews: [],
      prepPack: { whyThisRole: '', topFitPoints: '', likelyQuestions: '', questionsToAsk: '', technicalFocus: '', companyResearchLinks: '', prepScore: 0, prepStatus: 'NOT_STARTED' }
    };
    upsertJob(job);
    router.push('/jobs');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Add Job Lead" subtitle="Capture a role, seed the scoring, and move it into your workflow." />
      <div className="card-pad grid gap-4 md:grid-cols-2">
        {Object.entries(form).map(([key, value]) => (
          <div key={key} className={key === 'notes' ? 'md:col-span-2' : ''}>
            <label className="mb-2 block text-sm text-muted">{key}</label>
            {key === 'notes' ? (
              <textarea className="input min-h-28" value={value} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            ) : (
              <input className="input" value={value} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button onClick={submit} className="btn-primary">Save job</button>
        <button onClick={() => router.back()} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
