'use client';

/**
 * Application-materials library.
 *
 * The library is an overview, not a second editor. Materials are grouped by the
 * job they belong to, so one application's cover letter, outreach and follow-up
 * are always read together and open in the same workspace. General materials
 * (no target job) and archived drafts stay separate and clearly labelled.
 *
 * Every list and delete goes through the session-scoped API; this component
 * never receives or sends another user's id.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import {
  MATERIAL_TYPE_META,
  type MaterialType,
} from '@/lib/application-materials/materials';
import {
  groupLibraryMaterials,
  jobStatusLabel,
  type LibraryMaterial,
} from '@/lib/application-materials/workspace';

type SerialisedMaterial = LibraryMaterial & {
  subject: string | null;
  origin: string;
  errorCode: string | null;
  thinInputs: boolean;
  editVersion: number;
  data: unknown;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  ARCHIVED: 'Archived',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

async function fetchMaterials(): Promise<SerialisedMaterial[]> {
  const response = await fetch('/api/application-materials?take=100', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'Could not load your materials.');
  }
  if (!Array.isArray(payload.materials)) {
    throw new Error('The materials service returned an unexpected response.');
  }
  return payload.materials as SerialisedMaterial[];
}

export default function ApplicationMaterialsWorkspace() {
  const [materials, setMaterials] = useState<SerialisedMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');

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

  const active = useMemo(
    () => materials.filter((material) => material.status !== 'ARCHIVED'),
    [materials],
  );
  const archived = useMemo(
    () => materials.filter((material) => material.status === 'ARCHIVED'),
    [materials],
  );
  const { kits, general } = useMemo(() => groupLibraryMaterials(active), [active]);

  const handleDelete = async (material: LibraryMaterial) => {
    if (!window.confirm(`Permanently delete “${material.title}”? This cannot be undone.`)) {
      return;
    }
    setDeletingId(material.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/application-materials/${material.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Could not delete this material.');
      }
      setMaterials((current) => current.filter((item) => item.id !== material.id));
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete this material.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return <div className="card-pad">Loading your application materials…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application kits"
        subtitle="Every job’s materials and linked resumes in one place. Nothing is sent automatically."
        action={
          <Link href="/application-materials/new" className="btn-primary">
            Create material
          </Link>
        }
      />

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger-text"
        >
          <p>{error}</p>
          <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger-text"
        >
          {actionError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn text-xs ${tab === 'active' ? 'btn-primary' : 'btn-secondary'}`}
          aria-pressed={tab === 'active'}
          onClick={() => setTab('active')}
        >
          Active ({active.length})
        </button>
        <button
          type="button"
          className={`btn text-xs ${tab === 'archived' ? 'btn-primary' : 'btn-secondary'}`}
          aria-pressed={tab === 'archived'}
          onClick={() => setTab('archived')}
        >
          Archived ({archived.length})
        </button>
        <span className="muted ml-auto text-xs">
          {plural(kits.length, 'application kit')} · {plural(general.length, 'general material')}
        </span>
      </div>

      {tab === 'archived' ? (
        <ArchivedSection
          materials={archived}
          deletingId={deletingId}
          onDelete={handleDelete}
        />
      ) : (
        <>
          <section aria-labelledby="kits-heading" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="kits-heading" className="text-lg font-semibold text-ink">
                By application
              </h2>
              <span className="muted text-xs">Open a kit to write or review its next draft.</span>
            </div>

            {kits.length === 0 ? (
              <div className="card-pad py-10 text-center">
                <p className="text-sm font-medium text-ink">No application kits yet.</p>
                <p className="muted mx-auto mt-1 max-w-md text-sm">
                  A kit is created automatically when you write a material for a job. Open a job
                  and choose its application kit to begin.
                </p>
                <Link href="/jobs" className="btn-secondary mt-4 inline-flex text-xs">
                  Browse your jobs
                </Link>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {kits.map((kit) => {
                  const title = kit.job?.title ?? 'A deleted job';
                  const company = kit.job?.company ?? 'Job removed from your pipeline';
                  const latest = kit.materials[0];
                  return (
                    <article
                      key={kit.jobId}
                      className="card-pad flex flex-col transition-colors hover:border-line-strong"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
                          <p className="muted mt-1 truncate text-sm">{company}</p>
                        </div>
                        {kit.job?.status ? (
                          <span className="badge bg-surface-sunken text-ink-2">
                            {jobStatusLabel(kit.job.status)}
                          </span>
                        ) : null}
                      </div>

                      <p className="muted mt-3 text-xs">
                        {plural(kit.materials.length, 'material')} ·{' '}
                        {plural(kit.draftCount, 'draft')} · {plural(kit.readyCount, 'ready')} ·
                        updated {formatDate(kit.latestAt)}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {kit.types.map((type) => (
                          <span
                            key={type}
                            className="badge bg-surface-sunken text-ink-2"
                          >
                            {MATERIAL_TYPE_META[type as MaterialType]?.label ?? type}
                          </span>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                        <Link
                          href={`/application-materials/jobs/${kit.jobId}`}
                          className="btn-primary text-xs"
                        >
                          Open application kit
                        </Link>
                        {latest ? (
                          <Link
                            href={`/application-materials/${latest.id}`}
                            className="btn-secondary text-xs"
                          >
                            Latest draft
                          </Link>
                        ) : null}
                        {kit.job ? (
                          <Link
                            href={`/jobs/${kit.job.id}`}
                            className="ml-auto text-xs text-accent-text underline underline-offset-2"
                          >
                            Job details
                          </Link>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <GeneralSection
            materials={general}
            deletingId={deletingId}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  );
}

function ArchivedSection({
  materials,
  deletingId,
  onDelete,
}: {
  materials: LibraryMaterial[];
  deletingId: string | null;
  onDelete: (material: LibraryMaterial) => Promise<void>;
}) {
  return (
    <section className="card-pad" aria-labelledby="archived-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="archived-heading" className="text-lg font-semibold text-ink">
          Archived materials
        </h2>
        <span className="muted text-xs">Hidden from your active kits. Never deleted automatically.</span>
      </div>
      {materials.length === 0 ? (
        <p className="muted mt-4 text-sm">No archived materials.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {materials.map((material) => (
            <li key={material.id} className="rounded-xl border border-line bg-surface-sunken p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/application-materials/${material.id}`}
                    className="block truncate text-sm font-medium text-ink hover:text-accent-text"
                  >
                    {material.title}
                  </Link>
                  <p className="muted mt-1 text-xs">
                    {MATERIAL_TYPE_META[material.type as MaterialType]?.label ?? material.type}
                    {material.job ? ` · ${material.job.title} at ${material.job.company}` : ''} ·
                    archived {formatDate(material.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/application-materials/${material.id}`} className="btn-secondary text-xs">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-danger-text"
                    disabled={deletingId !== null}
                    onClick={() => void onDelete(material)}
                  >
                    {deletingId === material.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GeneralSection({
  materials,
  deletingId,
  onDelete,
}: {
  materials: LibraryMaterial[];
  deletingId: string | null;
  onDelete: (material: LibraryMaterial) => Promise<void>;
}) {
  return (
    <section className="card-pad" aria-labelledby="general-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="general-heading" className="text-lg font-semibold text-ink">
          General materials
        </h2>
        <span className="muted text-xs">Drafts without an active target job.</span>
      </div>

      {materials.length === 0 ? (
        <p className="muted mt-4 text-sm">
          Nothing here. A recruiter message written without a job lives here, as does any draft
          whose job was removed from your pipeline.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {materials.map((material) => (
            <li key={material.id} className="rounded-xl border border-line bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/application-materials/${material.id}`}
                    className="block truncate text-sm font-medium text-ink hover:text-accent-text"
                  >
                    {material.title}
                  </Link>
                  <p className="muted mt-1 text-xs">
                    {MATERIAL_TYPE_META[material.type as MaterialType]?.label ?? material.type}
                    {material.job
                      ? ` · ${material.job.title} at ${material.job.company} (job removed)`
                      : ''}{' '}
                    · {STATUS_LABELS[material.status] ?? material.status} · updated{' '}
                    {formatDate(material.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/application-materials/${material.id}`} className="btn-secondary text-xs">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-danger-text"
                    disabled={deletingId !== null}
                    onClick={() => void onDelete(material)}
                  >
                    {deletingId === material.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
