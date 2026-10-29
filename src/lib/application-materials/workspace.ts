/**
 * Shared contracts and pure helpers for application kits.
 *
 * An "application kit" is not a new database entity. It is the set of records
 * that already belong to one `JobLead`: the materials written for it, the
 * tailored resumes associated with it, and the application facts that decide
 * which material types are honest to offer.
 *
 * Everything in this file is pure. The server loader and the client use the same
 * grouping and availability rules, so the UI can never offer a follow-up for a
 * role the server would refuse to generate one for.
 */

import {
  APPLICATION_GROUNDED_TYPES,
  MATERIAL_TYPE_META,
  MATERIAL_TYPES,
  type MaterialType,
} from './materials';

// ─── Workspace data ─────────────────────────────────────────────────────────

export type WorkspaceMaterialSummary = {
  id: string;
  type: string;
  title: string;
  subject: string | null;
  status: string;
  origin: string;
  generationStatus: string;
  revision: number;
  editVersion: number;
  resumeId: string | null;
  resumeName: string | null;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  thinInputs: boolean;
};

export type WorkspaceResumeSummary = {
  id: string;
  name: string;
  revision: number;
  origin: string;
  targetJobId: string | null;
  updatedAt: string;
  /** How many of this job's materials explicitly used this resume. */
  usedByMaterials: number;
};

export type WorkspaceContact = {
  name: string;
  title: string;
  company: string;
  relationshipType: string;
};

export type WorkspaceInterview = {
  scheduledAt: string;
  stage: string;
  type: string;
};

export type WorkspaceJobSummary = {
  id: string;
  title: string;
  company: string;
  location: string;
  remoteType: string;
  status: string;
  jobUrl: string | null;
  dateApplied: string | null;
  nextFollowUp: string | null;
  hasDescription: boolean;
  updatedAt: string;
  contacts: WorkspaceContact[];
  interviews: WorkspaceInterview[];
};

export type MaterialAvailability = {
  /** False when the pipeline record cannot honestly support this material yet. */
  canGenerate: boolean;
  /** Why it is blocked, in user-facing words. Null when it is not. */
  reason: string | null;
  /** Extra guidance shown in the composer even when generation is allowed. */
  note: string | null;
};

export type WorkspaceSummary = {
  totalMaterials: number;
  activeMaterials: number;
  draftCount: number;
  readyCount: number;
  archivedCount: number;
  failedCount: number;
  resumeCount: number;
  tailoredResumeCount: number;
  hasApplied: boolean;
  hasInterview: boolean;
  latestActivityAt: string | null;
};

export type ApplicationWorkspaceData = {
  job: WorkspaceJobSummary;
  materials: WorkspaceMaterialSummary[];
  /** Every resume the user owns, so the workspace can link one as well as show linked ones. */
  resumes: WorkspaceResumeSummary[];
  availability: Record<MaterialType, MaterialAvailability>;
  summary: WorkspaceSummary;
  generatedAt: string;
};

// ─── Availability ───────────────────────────────────────────────────────────

export function resolveMaterialAvailability(input: {
  type: MaterialType;
  hasApplied: boolean;
  hasInterview: boolean;
  hasContacts: boolean;
}): MaterialAvailability {
  if (input.type === 'INTERVIEW_THANK_YOU') {
    return {
      canGenerate: true,
      reason: null,
      note: input.hasInterview
        ? 'The recorded interview is already part of the context.'
        : 'No interview is recorded. Add your own notes below so the note only refers to what actually happened.',
    };
  }

  if (APPLICATION_GROUNDED_TYPES.includes(input.type) && !input.hasApplied) {
    return {
      canGenerate: false,
      reason:
        'Move this role to Applied in your pipeline first. A follow-up that describes an application you have not submitted would not be true.',
      note: null,
    };
  }

  if (
    (input.type === 'RECRUITER_OUTREACH' || input.type === 'LINKEDIN_CONNECTION') &&
    !input.hasContacts
  ) {
    return {
      canGenerate: true,
      reason: null,
      note: 'No contact is saved for this role yet. The draft will stay general unless you add one.',
    };
  }

  return { canGenerate: true, reason: null, note: null };
}

export function buildAvailabilityMap(input: {
  hasApplied: boolean;
  hasInterview: boolean;
  hasContacts: boolean;
}): Record<MaterialType, MaterialAvailability> {
  return Object.fromEntries(
    MATERIAL_TYPES.map((type) => [type, resolveMaterialAvailability({ ...input, type })]),
  ) as Record<MaterialType, MaterialAvailability>;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

export type WorkspaceMaterialGroup = {
  type: MaterialType;
  label: string;
  description: string;
  materials: WorkspaceMaterialSummary[];
  /** Newest non-archived material, falling back to the newest archived one. */
  latest: WorkspaceMaterialSummary | null;
  activeCount: number;
  archivedCount: number;
};

function newestFirst<T extends { updatedAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byDate = b.updatedAt.localeCompare(a.updatedAt);
    return byDate;
  });
}

export function groupWorkspaceMaterials(
  materials: WorkspaceMaterialSummary[],
): WorkspaceMaterialGroup[] {
  return MATERIAL_TYPES.map((type) => {
    const meta = MATERIAL_TYPE_META[type];
    const typed = newestFirst(materials.filter((material) => material.type === type));
    const active = typed.filter((material) => material.status !== 'ARCHIVED');
    return {
      type,
      label: meta.label,
      description: meta.description,
      materials: typed,
      latest: active[0] ?? typed[0] ?? null,
      activeCount: active.length,
      archivedCount: typed.length - active.length,
    };
  });
}

export type KitStep = {
  key: 'RESUME' | 'COVER_LETTER' | 'OUTREACH' | 'FOLLOW_UP';
  label: string;
  detail: string;
  complete: boolean;
};

/**
 * A compact, honest picture of what an application kit already contains.
 *
 * "Follow-up" changes to "Thank-you note" once an interview is recorded, and
 * neither is presented as missing before the application was submitted.
 */
export function buildKitSteps(input: {
  jobId: string;
  materials: WorkspaceMaterialSummary[];
  resumes: WorkspaceResumeSummary[];
  hasApplied: boolean;
  hasInterview: boolean;
}): KitStep[] {
  const active = input.materials.filter((material) => material.status !== 'ARCHIVED');
  const hasType = (...types: string[]) => active.some((material) => types.includes(material.type));

  const resumeLinked = input.resumes.some(
    (resume) => resume.targetJobId === input.jobId || resume.usedByMaterials > 0,
  );

  const followUpLabel = input.hasInterview ? 'Thank-you note' : 'Follow-up';
  let followUpDetail = 'Available after you apply.';
  let followUpComplete = false;
  if (input.hasInterview) {
    followUpComplete = hasType('INTERVIEW_THANK_YOU');
    followUpDetail = followUpComplete
      ? 'Written after a recorded interview.'
      : 'Recorded interviews are ready for a thank-you note.';
  } else if (input.hasApplied) {
    followUpComplete = hasType('APPLICATION_FOLLOW_UP', 'APPLICATION_STATUS_CHECK');
    followUpDetail = followUpComplete
      ? 'A follow-up or status check is drafted.'
      : 'Draft one when the role goes quiet.';
  }

  return [
    {
      key: 'RESUME',
      label: 'Tailored resume',
      complete: resumeLinked,
      detail: resumeLinked
        ? 'A resume is linked to this role.'
        : 'Link or create a resume for this role.',
    },
    {
      key: 'COVER_LETTER',
      label: 'Cover letter',
      complete: hasType('COVER_LETTER'),
      detail: hasType('COVER_LETTER')
        ? 'A cover letter is drafted.'
        : 'Write the letter that goes with the application.',
    },
    {
      key: 'OUTREACH',
      label: 'Outreach',
      complete: hasType('RECRUITER_OUTREACH', 'LINKEDIN_CONNECTION'),
      detail: hasType('RECRUITER_OUTREACH', 'LINKEDIN_CONNECTION')
        ? 'A recruiter or LinkedIn message is drafted.'
        : 'Optional: introduce yourself to a real contact.',
    },
    {
      key: 'FOLLOW_UP',
      label: followUpLabel,
      complete: followUpComplete,
      detail: followUpDetail,
    },
  ];
}

// ─── Library grouping ───────────────────────────────────────────────────────

export type LibraryJob = {
  id: string;
  title: string;
  company: string;
  status: string;
  /** Present so a material whose job was soft-deleted is not offered a 404 kit. */
  deletedAt?: string | null;
};

/** User-facing pipeline labels, shared by the library and the kit. */
export const JOB_STATUS_LABELS: Record<string, string> = {
  LEAD: 'Lead',
  SAVED: 'Saved',
  APPLYING: 'Applying',
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

export function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

export type LibraryMaterial = {
  id: string;
  type: string;
  title: string;
  status: string;
  generationStatus: string;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
  job?: LibraryJob | null;
};

export type LibraryKit = {
  jobId: string;
  job: LibraryJob | null;
  materials: LibraryMaterial[];
  latestAt: string;
  draftCount: number;
  readyCount: number;
  types: string[];
};

export function groupLibraryMaterials(
  materials: LibraryMaterial[],
): { kits: LibraryKit[]; general: LibraryMaterial[] } {
  const kits = new Map<string, LibraryKit>();
  const general: LibraryMaterial[] = [];

  for (const material of materials) {
    // A soft-deleted job has no kit page. Its materials belong with the general
    // drafts rather than behind a link that would 404.
    if (!material.jobId || !material.job || material.job.deletedAt) {
      general.push(material);
      continue;
    }

    const existing = kits.get(material.jobId);
    if (existing) {
      existing.materials.push(material);
      continue;
    }

    kits.set(material.jobId, {
      jobId: material.jobId,
      job: material.job ?? null,
      materials: [material],
      latestAt: material.updatedAt,
      draftCount: 0,
      readyCount: 0,
      types: [],
    });
  }

  for (const kit of kits.values()) {
    kit.materials = newestFirst(kit.materials);
    kit.latestAt = kit.materials[0]?.updatedAt ?? kit.latestAt;
    kit.draftCount = kit.materials.filter((material) => material.status === 'DRAFT').length;
    kit.readyCount = kit.materials.filter((material) => material.status === 'READY').length;
    kit.types = [...new Set(kit.materials.map((material) => material.type))];
  }

  general.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    kits: [...kits.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt)),
    general,
  };
}
