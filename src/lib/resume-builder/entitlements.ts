/**
 * Feature keys used by the Resume Builder.
 *
 * Aliases for keys that already exist in `src/lib/billing/plans.ts` — the
 * central registry — rather than new ones. `RESUME_BUILDER` and
 * `RESUME_OPTIMIZATION` were both defined at the monetization launch as
 * unreleased Pro capabilities and are shipped by this release, so there is no
 * new plan, no new limit, no new usage table and no parallel quota system.
 *
 * PDF EXPORT HAS NO KEY OF ITS OWN, deliberately. A built resume cannot exist
 * without `RESUME_BUILDER`, so a separate gate would be an invented
 * restriction rather than a product decision. Exporting an already-saved
 * document also costs no AI credit and is not metered.
 */

export const RESUME_BUILDER_FEATURE = 'RESUME_BUILDER' as const;
export const RESUME_OPTIMIZATION_FEATURE = 'RESUME_OPTIMIZATION' as const;