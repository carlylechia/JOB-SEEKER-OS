/**
 * Wire shapes for the Resume Builder API.
 *
 * Kept out of the route files on purpose: a Next.js route module may only
 * export HTTP verbs, and three routes need to return the same resume shape. One
 * serialiser means a field added to the document cannot be half-exposed by one
 * endpoint and quietly missing from another.
 *
 * Serialisation is deliberately shallow. Everything these functions touch has
 * already been validated, re-checked and bounded by the service layer, so this
 * is a type-and-date concern only.
 */

import type { StructuredResumeRecord } from './documents';
import type { OptimizationResult } from './optimization/schema';
import type { OptimizationSummary } from './optimization/service';
import type { TargetableJob } from './schema';
import type { LayoutDocument } from './layout';

/** The resume summary the list and the editor both consume. */
export function serialiseResume(resume: StructuredResumeRecord) {
  return {
    id: resume.id,
    name: resume.name,
    templateKey: resume.templateKey,
    accentKey: resume.accentKey,
    density: resume.density,
    hiddenSections: resume.hiddenSections,
    revision: resume.revision,
    origin: resume.origin,
    targetJobId: resume.targetJobId,
    targetJob: resume.targetJob,
    sourceResumeId: resume.sourceResumeId,
    sourceProfileVersion: resume.sourceProfileVersion,
    createdAt: resume.createdAt.toISOString(),
    updatedAt: resume.updatedAt.toISOString(),
    hasContent:
      Boolean(resume.content.basics.fullName || resume.content.summary) ||
      resume.content.experiences.length > 0,
  };
}

export type SerialisedResume = ReturnType<typeof serialiseResume>;

/** The full document, for the editor. */
export function serialiseResumeDetail(resume: StructuredResumeRecord) {
  return { ...serialiseResume(resume), content: resume.content };
}

export function serialiseTargetableJob(job: {
  id: string;
  title: string;
  company: string;
  status: string;
  hasDescription: boolean;
  updatedAt: Date;
}): TargetableJob {
  return { ...job, updatedAt: job.updatedAt.toISOString() };
}

export function serialiseOptimization(params: {
  optimization: OptimizationSummary;
  data: OptimizationResult;
  staleReasons: string[];
}) {
  return {
    id: params.optimization.id,
    resumeId: params.optimization.resumeId,
    jobId: params.optimization.jobId,
    status: params.optimization.status,
    createdAt: params.optimization.createdAt.toISOString(),
    completedAt: params.optimization.completedAt?.toISOString() ?? null,
    model: params.optimization.model,
    creditsConsumed: params.optimization.creditsConsumed,
    isFresh: params.optimization.isFresh,
    staleReasons: params.staleReasons,
    data: params.data,
  };
}

/**
 * The layout, ready for the preview renderer.
 *
 * The whole document goes over the wire — it is a few kilobytes — rather than a
 * summary, because the preview must draw the same blocks the PDF does. Shipping
 * anything less would mean the client re-implementing the layout, which is the
 * one thing this architecture exists to prevent.
 */
export function serialiseLayout(layout: LayoutDocument) {
  return layout;
}