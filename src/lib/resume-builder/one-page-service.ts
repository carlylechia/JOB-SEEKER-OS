/** User-scoped orchestration for one-page review and save. */

import { getEntitlements } from '@/lib/billing/subscriptions';
import {
  getResume,
  resolveTargetJob,
  ResumeRevisionConflictError,
  TargetJobNotFoundError,
  type StructuredResumeRecord,
} from './documents';
import {
  runOptimization,
  DuplicateOptimizationInFlightError,
  OptimizationStaleError,
} from './optimization/service';
import type { ReviewOperation } from './optimization/schema';
import { buildOnePageProposal, type OnePageInput, type OnePageProposal } from './one-page';

export type OnePageServiceResult = {
  source: StructuredResumeRecord;
  targetJobId: string | null;
  targetJob: { id: string; title: string; company: string; jobDescription: string | null } | null;
  proposal: OnePageProposal;
};

/**
 * Load all source material through owner-scoped queries. Optional AI rewrites
 * come from the existing optimization cache and pass through its verifier;
 * no AI result is persisted to the candidate resume before review.
 */
export async function prepareOnePageProposal(params: {
  userId: string;
  resumeId: string;
  input: OnePageInput;
  route: string;
}): Promise<OnePageServiceResult> {
  const source = await getResume({ userId: params.userId, resumeId: params.resumeId });
  const targetJobId = params.input.targetJobId === undefined
    ? source.targetJobId
    : params.input.targetJobId;
  const targetJob = await resolveTargetJob({ userId: params.userId, jobId: targetJobId });
  let operations: ReviewOperation[] = [];
  let aiNotice: string | null = null;

  if (params.input.useAi) {
    if (!targetJob) {
      aiNotice = 'Choose a saved target job to get AI wording suggestions. The general one-page version uses deterministic content selection.';
    } else {
      const entitlements = await getEntitlements(params.userId);
      if (!entitlements.features.RESUME_OPTIMIZATION) {
        aiNotice = 'AI job-specific suggestions are not included with the current plan. You can still create a one-page version from your existing content.';
      } else {
        try {
          const result = await runOptimization({
            userId: params.userId,
            resumeId: source.id,
            jobId: targetJob.id,
            route: params.route,
          });
          if (result.outcome === 'COMPLETED' || result.outcome === 'REUSED') {
            operations = result.data.operations;
          } else {
            aiNotice = 'AI suggestions were unavailable for this run. The one-page selection still uses your existing resume content.';
          }
        } catch (error) {
          if (
            error instanceof DuplicateOptimizationInFlightError ||
            error instanceof OptimizationStaleError ||
            error instanceof ResumeRevisionConflictError ||
            error instanceof TargetJobNotFoundError
          ) throw error;
          aiNotice = 'AI suggestions were unavailable for this run. The one-page selection still uses your existing resume content.';
        }
      }
    }
  }

  const current = await getResume({ userId: params.userId, resumeId: source.id });
  if (current.revision !== source.revision) {
    throw new ResumeRevisionConflictError(current.revision);
  }

  const proposal = await buildOnePageProposal({
    source: current.content,
    target: targetJob,
    targetRole: targetJob ? null : params.input.targetRole,
    objective: params.input.objective,
    templateKey: params.input.templateKey ?? 'classic-ats',
    pageSize: params.input.pageSize ?? current.pageSize,
    includedKeys: params.input.includedKeys,
    acceptedOperationIds: params.input.acceptedOperationIds,
    summaryOverride: params.input.summaryOverride,
    editedItems: params.input.editedItems,
    operations,
    aiNotice,
  });

  return { source: current, targetJobId: targetJob?.id ?? null, targetJob, proposal };
}
