'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Building2, Download, Loader2, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { InterviewTypePicker } from '@/components/interview-prep/interview-type-picker';
import type { InterviewContext } from '@/lib/interview-prep/schema';
import type { JobLead } from '@/types';

type Access = { canGenerate: boolean; plan: string; aiCreditsRemaining: number | null };

type JobOption = Pick<
  JobLead,
  'id' | 'company' | 'title' | 'location' | 'jobUrl' | 'jobDescription' | 'status'
>;

type ImportedJob = {
  url: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
};

const TIMINGS = [
  { value: '', label: 'Let the date decide (or unknown)' },
  { value: 'WITHIN_24_HOURS', label: 'Within 24 hours' },
  { value: 'TWO_THREE_DAYS', label: 'In 2–3 days' },
  { value: 'WITHIN_A_WEEK', label: 'Within a week' },
  { value: 'MORE_THAN_A_WEEK', label: 'More than a week away' },
  { value: 'UNKNOWN', label: 'Not sure yet' },
] as const;

function toDatetimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function NewPackForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedJobId = searchParams.get('jobId') ?? '';

  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [access, setAccess] = useState<Access | null>(null);

  const [jobId, setJobId] = useState(preselectedJobId);
  const [company, setCompany] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [location, setLocation] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState('');
  const [careersUrl, setCareersUrl] = useState('');
  const [researchUrls, setResearchUrls] = useState('');
  const [interviewAt, setInterviewAt] = useState('');
  const [timing, setTiming] = useState('');
  const [context, setContext] = useState<InterviewContext>('BALANCED');
  const [interviewLanguage, setInterviewLanguage] = useState('');
  const [interviewerInfo, setInterviewerInfo] = useState('');
  const [concerns, setConcerns] = useState('');
  const [focusTopics, setFocusTopics] = useState('');
  const [generate, setGenerate] = useState(true);

  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedJob = useMemo(() => jobs.find((job) => job.id === jobId) ?? null, [jobs, jobId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [jobsRes, accessRes] = await Promise.all([
          fetch('/api/jobs', { cache: 'no-store' }),
          fetch('/api/interview-prep', { cache: 'no-store' }),
        ]);
        if (!cancelled) {
          if (jobsRes.ok) {
            const json = (await jobsRes.json()) as { jobs: JobOption[] };
            setJobs(json.jobs ?? []);
          }
          if (accessRes.ok) {
            const json = (await accessRes.json()) as { access: Access };
            setAccess(json.access);
            setGenerate(json.access.canGenerate);
          }
        }
      } catch {
        // The form still works manually; only the job picker is unavailable.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyJob = (job: JobOption | null) => {
    if (!job) {
      setJobId('');
      return;
    }
    setJobId(job.id);
    setCompany(job.company);
    setRoleTitle(job.title);
    setLocation(job.location ?? '');
    setJobUrl(job.jobUrl ?? '');
    setJobDescription(job.jobDescription ?? '');
  };

  useEffect(() => {
    if (!selectedJob) return;
    applyJob(selectedJob);
    // Only prefill when the selection changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.id]);

  async function handleImport() {
    if (!jobUrl.trim()) {
      setError('Paste the job posting URL first.');
      return;
    }
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/interview-prep/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: jobUrl.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        imported?: ImportedJob;
        error?: { message?: string };
      };
      if (!res.ok || !json.imported) {
        setError(json.error?.message ?? 'That job posting could not be read.');
        return;
      }
      const imported = json.imported;
      setCompany((current) => current || imported.company);
      setRoleTitle((current) => current || imported.title);
      setLocation((current) => current || imported.location || '');
      setJobDescription(imported.description);
      setNotice('Job description imported. Review it before generating the pack.');
    } catch {
      setError('That job posting could not be read. You can paste the description instead.');
    } finally {
      setImporting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!jobId && (!company.trim() || !roleTitle.trim())) {
      setError('Add the company and role title, or choose a saved job.');
      return;
    }
    if (jobDescription.trim().length > 0 && jobDescription.trim().length < 40) {
      setError('The job description is too short to build a useful pack. Paste the full posting or clear it.');
      return;
    }

    const urls = researchUrls
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const res = await fetch('/api/interview-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId || null,
          company: company.trim() || undefined,
          roleTitle: roleTitle.trim() || undefined,
          location: location.trim() || null,
          jobUrl: jobUrl.trim() || null,
          jobDescription: jobDescription.trim() || null,
          companyWebsiteUrl: companyWebsiteUrl.trim() || null,
          careersUrl: careersUrl.trim() || null,
          researchUrls: urls,
          interviewAt: interviewAt ? new Date(interviewAt).toISOString() : null,
          timing: timing || undefined,
          context,
          interviewFormat: context,
          interviewLanguage: interviewLanguage.trim() || null,
          interviewerInfo: interviewerInfo.trim() || null,
          concerns: concerns.trim() || null,
          focusTopics: focusTopics
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 8),
          generate,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        pack?: { id: string };
        error?: { message?: string; code?: string };
      };
      if (!res.ok || !json.pack) {
        setError(
          json.error?.message ??
            'The preparation pack could not be created. Please check the details and try again.',
        );
        return;
      }
      router.push(`/interview-prep/${json.pack.id}`);
    } catch {
      setError('The preparation pack could not be created. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <div>
        <Link className="btn-secondary text-sm" href="/interview-prep">
          <ArrowLeft className="mr-1 inline h-4 w-4" aria-hidden />
          Back to prep packs
        </Link>
      </div>

      <PageHeader
        title="New preparation pack"
        subtitle="Tell us about the interview. The more specific the inputs, the more useful the pack — and the clearer its limits."
      />

      {access && !access.canGenerate ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.08] p-4">
          <p className="text-sm font-medium text-ink">Generating a pack requires a Pro plan.</p>
          <p className="muted mt-1">
            You can still save the details as a draft. Existing packs remain readable and practiseable.
          </p>
          <Link className="btn-secondary mt-3 inline-flex text-sm" href="/settings/billing">
            View plans
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger/25 bg-danger/[0.06] p-4 text-sm">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-success/25 bg-success/[0.06] p-4 text-sm">{notice}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="card-pad space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent-text" aria-hidden />
            <h2 className="font-semibold">Role and employer</h2>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="saved-job">
              Start from a saved job
            </label>
            <select
              id="saved-job"
              className="input"
              value={jobId}
              onChange={(event) => applyJob(jobs.find((job) => job.id === event.target.value) ?? null)}
              disabled={loading}
            >
              <option value="">No saved job — enter the details manually</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.company} — {job.title}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Choosing a saved job also links the pack to that job in your tracker.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="company">
                Company
              </label>
              <input
                id="company"
                className="input"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                required={!jobId}
                maxLength={160}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="role-title">
                Role title
              </label>
              <input
                id="role-title"
                className="input"
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
                required={!jobId}
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="location">
                Location <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="location"
                className="input"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="job-url">
                Job posting URL <span className="font-normal text-muted">(optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="job-url"
                  className="input"
                  type="url"
                  value={jobUrl}
                  onChange={(event) => setJobUrl(event.target.value)}
                  placeholder="https://…"
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0 text-sm"
                  onClick={() => void handleImport()}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden />
                  )}
                  <span className="ml-1 hidden sm:inline">Import</span>
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="job-description">
              Job description
            </label>
            <textarea
              id="job-description"
              className="input min-h-[180px]"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="Paste the posting here, or import it from the URL above. This is the primary source for the role analysis."
              maxLength={60_000}
            />
            <p className="mt-1 text-xs text-muted">
              {jobDescription.length.toLocaleString()} characters. Generation needs at least a substantial
              description; a URL alone is read automatically only when this is left empty.
            </p>
          </div>
        </section>

        <section className="card-pad space-y-4">
          <h2 className="font-semibold">Interview details</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="interview-at">
                Interview date and time <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="interview-at"
                className="input"
                type="datetime-local"
                value={interviewAt}
                onChange={(event) => setInterviewAt(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="timing">
                If the date is not set
              </label>
              <select
                id="timing"
                className="input"
                value={timing}
                onChange={(event) => setTiming(event.target.value)}
              >
                {TIMINGS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium">Interview type</span>
            <InterviewTypePicker
              value={context}
              onChange={setContext}
              idPrefix="new-pack-interview-type"
            />
            <p className="mt-2 text-xs text-muted">
              This changes what the pack generates: behavioural packs build an example bank, technical packs
              test reasoning and trade-offs, and case-study packs practise structured analysis.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="language">
              Interview language <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="language"
              className="input"
              value={interviewLanguage}
              onChange={(event) => setInterviewLanguage(event.target.value)}
              placeholder="e.g. English, French"
              maxLength={80}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="interviewer">
              Interviewer or panel <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="interviewer"
              className="input"
              value={interviewerInfo}
              onChange={(event) => setInterviewerInfo(event.target.value)}
              placeholder="Names, roles, or what you know about the panel"
              maxLength={2_000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="concerns">
                What worries you? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="concerns"
                className="input"
                rows={3}
                value={concerns}
                onChange={(event) => setConcerns(event.target.value)}
                placeholder="e.g. I have less hands-on Kubernetes experience than the posting asks for."
                maxLength={1_200}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="focus-topics">
                Focus topics <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="focus-topics"
                className="input"
                value={focusTopics}
                onChange={(event) => setFocusTopics(event.target.value)}
                placeholder="Comma separated, e.g. system design, stakeholder management"
                maxLength={600}
              />
            </div>
          </div>
        </section>

        <section className="card-pad space-y-4">
          <h2 className="font-semibold">Company research sources</h2>
          <p className="muted text-sm">
            We only research pages you explicitly supply. There is no web search: every company claim in
            the pack is either tied to one of these sources or clearly marked as an inference.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="company-website">
                Company website <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="company-website"
                className="input"
                type="url"
                value={companyWebsiteUrl}
                onChange={(event) => setCompanyWebsiteUrl(event.target.value)}
                placeholder="https://company.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="careers-url">
                Careers page <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="careers-url"
                className="input"
                type="url"
                value={careersUrl}
                onChange={(event) => setCareersUrl(event.target.value)}
                placeholder="https://company.com/careers"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="research-urls">
              Additional official pages <span className="font-normal text-muted">(one per line)</span>
            </label>
            <textarea
              id="research-urls"
              className="input"
              rows={3}
              value={researchUrls}
              onChange={(event) => setResearchUrls(event.target.value)}
              placeholder={'https://company.com/about\nhttps://company.com/newsroom\nhttps://company.com/investors'}
            />
            <p className="mt-1 text-xs text-muted">
              Public http(s) pages only. Private addresses, redirects to private networks and oversized
              pages are rejected.
            </p>
          </div>
        </section>

        <section className="card-pad space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-line"
              checked={generate}
              onChange={(event) => setGenerate(event.target.checked)}
              disabled={access ? !access.canGenerate : false}
            />
            <span>
              <span className="block text-sm font-medium">Generate the pack now</span>
              <span className="muted text-sm">
                Uses one AI operation from your shared monthly credit allowance. Leave unchecked to save a
                draft and generate later.
              </span>
            </span>
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" type="submit" disabled={submitting || loading}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden />
                {generate ? 'Building your pack…' : 'Saving draft…'}
              </>
            ) : (
              <>
                <Sparkles className="mr-1 inline h-4 w-4" aria-hidden />
                {generate ? 'Build preparation pack' : 'Save draft'}
              </>
            )}
          </button>
          <Link className="btn-secondary" href="/interview-prep">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function NewInterviewPrepPage() {
  return (
    <Suspense fallback={<div className="card-pad">Loading…</div>}>
      <NewPackForm />
    </Suspense>
  );
}
