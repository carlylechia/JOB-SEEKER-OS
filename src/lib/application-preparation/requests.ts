/**
 * Request schemas for the preparation workflow.
 *
 * Strict objects: an unexpected field is a 422 rather than a silently ignored
 * value. Task names are the database enum, so an unknown task can never reach
 * the planner.
 */

import { z } from 'zod';

import { PREPARATION_TASK_TYPES } from './types';

export const preparationTaskTypeSchema = z.enum(PREPARATION_TASK_TYPES);

export const createPreparationRunRequestSchema = z
  .object({
    /** Omitted means "use the planner's default selection". */
    tasks: z.array(preparationTaskTypeSchema).min(1).max(4).optional(),
  })
  .strict();

export type CreatePreparationRunRequest = z.infer<typeof createPreparationRunRequestSchema>;

export const advancePreparationRunRequestSchema = z
  .object({
    /**
     * How many tasks this call may execute. Defaults to one so a slow provider
     * cannot hold a single request open for the whole task set.
     */
    maxTasks: z.number().int().min(1).max(4).optional(),
  })
  .strict();

export type AdvancePreparationRunRequest = z.infer<typeof advancePreparationRunRequestSchema>;
