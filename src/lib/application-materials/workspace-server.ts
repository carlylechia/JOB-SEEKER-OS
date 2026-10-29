/**
 * Server loader for one job's application kit.
 *
 * Every query is scoped to the session user. A job belonging to someone else is
 * indistinguishable from one that does not exist, so the loader's 404 never
 * confirms that another user's private job exists.
 *
 * The loader is deliberately a single bounded pass: one job, at most 100 of its
 * materials, and at most 50 resumes the user owns. The UI needs the resume list
 * to offer "link an existing resume", not just the resumes already linked.
 */

import { prisma } from '@/lib/prisma';
import { APPLIED_STATUSES } from './materials';
import {
  buildAvailabilityMap,
  type ApplicationWorkspaceData,
  type WorkspaceContact,
  type WorkspaceInterview,
  type WorkspaceMaterialSummary,
  type WorkspaceResumeSummary,
} from './workspace';

export class ApplicationWorkspaceNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Application kit not found.');
    this.name = 'ApplicationWorkspaceNotFoundError';
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readText(value: unknown, max = 160): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function readContacts(value: unknown): WorkspaceContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const name = readText(record.name, 120);
      if (!name) return null;
      return {
        name,
        title: readText(record.title, 120),
        company: readText(record.company, 120),
        relationshipType: readText(record.relationshipType, 40),
      };
    })
    .filter((entry): entry is WorkspaceContact => entry !== null)
    .slice(0, 8);
}

function readInterviews(value: unknown): WorkspaceInterview[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const rawDate = record.scheduledAt;
      if (typeof rawDate !== 'string' || !rawDate) return null;
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) return null;
      return {
        scheduledAt: date.toISOString(),
        stage: readText(record.stage, 60),
        type:
          readText(record.interviewType, 60) ||
          readText(record.stage, 60) ||
          'Interview',
      };
    })
    .filter((entry): entry is WorkspaceInterview => entry !== null)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
    .slice(0, 6);
}

function maxIso(values: string[]): string | null {
  return values.length ? values.reduce((latest, value) => (value > latest ? value : latest)) : null;
}

export async function loadApplicationWorkspace(params: {
  userId: string;
  jobId: string;
}): Promise<ApplicationWorkspaceData> {
  const job = await prisma.jobLead.findFirst({
    where: { id: params.jobId, userId: params.userId, deletedAt: null },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      remoteType: true,
      status: true,
      jobUrl: true,
      dateApplied: true,
      nextFollowUp: true,
      jobDescription: true,
      contacts: true,
      interviews: true,
      updatedAt: true,
    },
  });

  if (!job) throw new ApplicationWorkspaceNotFoundError();

  const [materialRows, resumeRows] = await Promise.all([
    prisma.applicationMaterial.findMany({
      where: { userId: params.userId, jobId: params.jobId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        type: true,
        title: true,
        subject: true,
        status: true,
        origin: true,
        generationStatus: true,
        revision: true,
        editVersion: true,
        resumeId: true,
        createdAt: true,
        updatedAt: true,
        errorCode: true,
        thinInputs: true,
        resume: { select: { name: true } },
      },
    }),
    prisma.structuredResume.findMany({
      where: { userId: params.userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        name: true,
        revision: true,
        origin: true,
        targetJobId: true,
        updatedAt: true,
      },
    }),
  ]);

  const contacts = readContacts(job.contacts);
  const interviews = readInterviews(job.interviews);

  const hasApplied =
    APPLIED_STATUSES.includes(job.status) ||
    job.dateApplied !== null ||
    job.nextFollowUp !== null;
  const hasInterview = interviews.length > 0;

  const materials: WorkspaceMaterialSummary[] = materialRows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    subject: row.subject,
    status: row.status,
    origin: row.origin,
    generationStatus: row.generationStatus,
    revision: row.revision,
    editVersion: row.editVersion,
    resumeId: row.resumeId,
    resumeName: row.resume?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    errorCode: row.errorCode,
    thinInputs: row.thinInputs,
  }));

  const usageByResume = new Map<string, number>();
  for (const material of materials) {
    if (!material.resumeId) continue;
    usageByResume.set(material.resumeId, (usageByResume.get(material.resumeId) ?? 0) + 1);
  }

  const resumes: WorkspaceResumeSummary[] = resumeRows.map((resume) => ({
    id: resume.id,
    name: resume.name,
    revision: resume.revision,
    origin: resume.origin,
    targetJobId: resume.targetJobId,
    updatedAt: resume.updatedAt.toISOString(),
    usedByMaterials: usageByResume.get(resume.id) ?? 0,
  }));

  const linkedResumeCount = resumes.filter(
    (resume) => resume.targetJobId === params.jobId || resume.usedByMaterials > 0,
  ).length;
  const tailoredResumeCount = resumes.filter(
    (resume) => resume.targetJobId === params.jobId,
  ).length;

  const activeMaterials = materials.filter((material) => material.status !== 'ARCHIVED');
  const latestActivityAt = maxIso(materials.map((material) => material.updatedAt));

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location ?? '',
      remoteType: job.remoteType ?? '',
      status: job.status,
      jobUrl: job.jobUrl,
      dateApplied: job.dateApplied?.toISOString() ?? null,
      nextFollowUp: job.nextFollowUp?.toISOString() ?? null,
      hasDescription:
        typeof job.jobDescription === 'string' && job.jobDescription.trim().length >= 40,
      updatedAt: job.updatedAt.toISOString(),
      contacts,
      interviews,
    },
    materials,
    resumes,
    availability: buildAvailabilityMap({
      hasApplied,
      hasInterview,
      hasContacts: contacts.length > 0,
    }),
    summary: {
      totalMaterials: materials.length,
      activeMaterials: activeMaterials.length,
      draftCount: activeMaterials.filter((material) => material.status === 'DRAFT').length,
      readyCount: activeMaterials.filter((material) => material.status === 'READY').length,
      archivedCount: materials.length - activeMaterials.length,
      failedCount: materials.filter(
        (material) => material.generationStatus === 'FAILED',
      ).length,
      resumeCount: linkedResumeCount,
      tailoredResumeCount,
      hasApplied,
      hasInterview,
      latestActivityAt,
    },
    generatedAt: new Date().toISOString(),
  };
}
