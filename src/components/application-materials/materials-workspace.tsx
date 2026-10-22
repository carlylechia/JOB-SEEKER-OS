'use client';

/**
 * Application-materials workspace.
 *
 * Lists the user's saved cover letters and application messages, and provides
 * the entry point to create a new one. All data is scoped to the session user
 * by the API routes; this component never handles another user's id.
 */

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import Link from 'next/link';
import {
  MATERIAL_TYPES,
  type MaterialType,
  MATERIAL_TYPE_META,
} from '@/lib/application-materials/materials';

type SerialisedMaterial = {
  id: string;
  type: string;
  title: string;
  subject: string | null;
  status: string;
  origin: string;
  generationStatus: string;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  thinInputs: boolean;
  editVersion: number;
  data: unknown;
};

async function fetchMaterials(): Promise<SerialisedMaterial[]> {
  const res = await fetch('/api/application-materials', { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message ?? 'Could not load your materials.');
  }
  if (!Array.isArray(json.materials)) {
    throw new Error('The materials service returned an unexpected response.');
  }
  return json.materials;
}

const TYPE_LABELS: Record<string, string> = {
  COVER_LETTER: 'Cover letter',
  RECRUITER_OUTREACH: 'Recruiter message',
  LINKEDIN_CONNECTION: 'LinkedIn connection',
  APPLICATION_FOLLOW_UP: 'Application follow-up',
  APPLICATION_STATUS_CHECK: 'Status check',
  INTERVIEW_THANK_YOU: 'Interview thank-you',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  ARCHIVED: 'Archived',
};

export default function ApplicationMaterialsPage() {
  const [materials, setMaterials] = useState<SerialisedMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchMaterials();
      setMaterials(data);
      setError(null);
    } catch {
      setError('Could not load your materials. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = materials.filter((m) => m.status !== 'ARCHIVED');
  const archived = materials.filter((m) => m.status === 'ARCHIVED');
  const visibleMaterials = showArchived ? archived : active;

  if (isLoading) {
    return (
      <div className="card-pad">Loading your application materials…</div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application materials"
        subtitle="Draft cover letters and messages for your job applications. Nothing is sent automatically."
        action={
          <Link
            href="/application-materials/new"
            className="btn-primary"
          >
            Create material
          </Link>
        }
      />

      {error && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger-text"
          role="alert"
        >
          <p>{error}</p>
          <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      <section className="card-pad">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold text-ink">
            {showArchived ? 'Archived materials' : 'Your drafts'}
          </h2>
          {archived.length > 0 && (
            <button
              type="button"
              className="btn-secondary text-xs"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((visible) => !visible)}
            >
              {showArchived ? 'Show drafts' : `${archived.length} archived`}
            </button>
          )}
        </div>

        {visibleMaterials.length === 0 ? (
          <div className="card-pad text-center py-12">
            <div className="text-muted">
              {showArchived ? 'No archived materials.' : 'No drafts yet.'}
            </div>
            <p className="muted text-sm mt-2">
              {showArchived
                ? 'Archived materials will appear here.'
                : 'Create a cover letter or outreach message from a job or template.'}
            </p>
            {!showArchived && (
              <Link href="/application-materials/new" className="btn-primary mt-4 inline-block">
                Create your first material
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleMaterials.map((material) => {
              const meta = MATERIAL_TYPE_META[material.type as MaterialType];
              return (
                <div
                  key={material.id}
                  className="rounded-xl border border-line bg-card p-4 flex items-center gap-3"
                >
                  <div className="shrink-0 rounded-xl bg-surface-sunken p-2 text-muted">
                    {material.type === 'COVER_LETTER' ? '📄' : '✉️'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">
                      {material.title}
                    </div>
                    <div className="flex gap-2 text-xs muted mt-1">
                      <span>{TYPE_LABELS[material.type] ?? material.type}</span>
                      <span>·</span>
                      <span>
                        {STATUS_LABELS[material.status] ?? material.status}
                      </span>
                      {material.jobId && <span>· job</span>}
                    </div>
                    <div className="muted text-xs mt-1">
                      {new Date(material.updatedAt).toLocaleDateString()} updated
                    </div>
                  </div>
                  <Link
                    href={`/application-materials/${material.id}`}
                    className="ml-3 btn-secondary text-xs shrink-0"
                  >
                    Open
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
