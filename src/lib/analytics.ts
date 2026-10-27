/**
 * Lightweight first-party analytics helper.
 *
 * Fire-and-forget: never throws, never blocks the UI, and never breaks a
 * feature if the endpoint is unavailable. Events are validated server-side.
 */
export type AnalyticsEventName =
  | 'signup_completed'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'resume_added'
  | 'career_profile_completed'
  | 'job_discovery_viewed'
  | 'job_saved'
  | 'job_imported'
  | 'application_status_changed'
  | 'application_material_created'
  | 'interview_prep_started'
  | 'interview_prep_completed'
  | 'career_queue_action_completed'
  | 'weekly_review_completed'
  | 'upgrade_requested'
  | 'plan_changed'
  | 'trial_started'
  | 'trial_expired';

export function trackEvent(
  name: AnalyticsEventName,
  properties?: Record<string, string | number | boolean | null>,
): void {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, properties }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // ignore
  }
}
