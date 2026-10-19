/**
 * Feature keys used by AI application materials.
 *
 * Aliases for keys that already exist in `src/lib/billing/plans.ts` — the
 * central registry — rather than new ones. `AI_COVER_LETTER` was defined at the
 * monetization launch as an unreleased Pro capability and is shipped by this
 * release, so there is no new plan, no new limit, no new usage table and no
 * parallel quota system.
 *
 * The label and description already cover both cover letters and the other
 * application messages this release ships, so there is no `AI_APPLICATION_MESSAGE`
 * key. Two keys with identical plan grants and an identical `aiCredits` budget
 * would be a second name for one capability.
 *
 * PDF export has no key of its own, deliberately. Exporting an already-saved
 * document costs no AI credit and is not metered.
 */

export const APPLICATION_MATERIAL_FEATURE = 'AI_COVER_LETTER' as const;
