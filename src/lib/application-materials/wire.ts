/**
 * Wire shapes for the application-materials API.
 *
 * Kept out of the route files on purpose: several routes return the same
 * material shape, and one serialiser means a field cannot be half-exposed by
 * one endpoint and quietly missing from another.
 */

import type { ApplicationMaterial } from '@prisma/client';
import type { MaterialResult } from './schema';

/** The material summary the library and the job detail both consume. */
export function serialiseMaterial(material: {
  id: string;
  type: string;
  title: string;
  subject: string | null;
  status: string;
  origin: string;
  generationStatus: string;
  jobId: string | null;
  resumeId: string | null;
  templateId: string | null;
  revision: number;
  supersedesId: string | null;
  jobStage: string | null;
  appliedAt: Date | null;
  nextFollowUpAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  errorCode: string | null;
  model: string | null;
  creditsConsumed: number;
  thinInputs: boolean;
  editVersion: number;
  generationMeta: unknown;
}) {
  return {
    id: material.id,
    type: material.type,
    title: material.title,
    subject: material.subject,
    status: material.status,
    origin: material.origin,
    generationStatus: material.generationStatus,
    jobId: material.jobId,
    resumeId: material.resumeId,
    templateId: material.templateId,
    revision: material.revision,
    supersedesId: material.supersedesId,
    jobStage: material.jobStage,
    appliedAt: material.appliedAt?.toISOString() ?? null,
    nextFollowUpAt: material.nextFollowUpAt?.toISOString() ?? null,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
    errorCode: material.errorCode,
    model: material.model,
    creditsConsumed: material.creditsConsumed,
    thinInputs: material.thinInputs,
    editVersion: material.editVersion,
    data: material.generationMeta,
  };
}

export type SerialisedMaterial = ReturnType<typeof serialiseMaterial>;

export function getStoredMaterialContent(
  material: { content: string; generationMeta: unknown; status: string },
): string {
  if (material.content || material.status !== 'DRAFT') return material.content;

  const generatedContent =
    material.generationMeta &&
    typeof material.generationMeta === 'object' &&
    'content' in material.generationMeta &&
    typeof material.generationMeta.content === 'string'
      ? material.generationMeta.content
      : '';

  return material.content || generatedContent;
}

/** The full editable detail, for the review screen. */
export function serialiseMaterialDetail(material: ApplicationMaterial) {
  return {
    ...serialiseMaterial(material),
    // Older generated rows only stored the verified result in generationMeta.
    // Read from there until the user saves the material again.
    content: getStoredMaterialContent(material),
  };
}

export function serialiseGenerationResult(params: {
  material: SerialisedMaterial;
  result: MaterialResult;
}) {
  return {
    material: params.material,
    result: params.result,
  };
}
