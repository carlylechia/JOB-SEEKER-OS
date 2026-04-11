/**
 * Queue AI Enhancer — deterministic, no external API calls.
 *
 * Converts queue items into richer, more human-friendly text.
 * Structured so the `enhance()` function can be swapped out for
 * an OpenAI/Gemini call in the future without changing callers.
 *
 * Future hook points are marked with: // [AI-READY]
 */

import { QueueItem, QueueItemType } from './queue-engine';

// ─── Templates ───────────────────────────────────────────────────────────────

type TemplateVars = {
  company: string;
  jobTitle: string;
  priority: number;
};

const TEMPLATES: Record<QueueItemType, (vars: TemplateVars) => string> = {
  follow_up: ({ company, jobTitle }) =>
    `Send a follow-up message to ${company} about your "${jobTitle}" application. A brief, professional note can significantly improve your response rate.`,

  prep: ({ company, jobTitle }) =>
    `You have an active interview track with ${company} for "${jobTitle}". Review your prep pack, rehearse your top talking points, and prepare thoughtful questions for the interviewer.`,

  apply: ({ company, jobTitle, priority }) =>
    priority >= 90
      ? `This is a high-priority opportunity. Submit your application to ${company} for "${jobTitle}" today — strong matches like this move fast.`
      : `Your saved lead at ${company} for "${jobTitle}" is a strong fit. Move it to Applied: tailor your resume, attach your cover letter, and submit.`,

  stale: ({ company, jobTitle }) =>
    `Your lead at ${company} for "${jobTitle}" hasn't moved in a while. Take a moment to either advance it to Applied or archive it to keep your pipeline clean.`,

  review: ({ company, jobTitle }) =>
    `"${jobTitle}" at ${company} has a low fit score. Review whether the role requirements have changed or if this is worth pursuing further — it may be worth archiving.`,
};

// ─── Enhancer ─────────────────────────────────────────────────────────────────

/**
 * Enhances a queue item's description with more human-friendly copy.
 * Pure function — returns a new QueueItem without mutating the input.
 *
 * [AI-READY]: Replace the template lookup with an async LLM call here.
 * The signature intentionally returns `QueueItem` (not `Promise<QueueItem>`)
 * so callers can batch-enhance synchronously; upgrade to async when needed.
 */
export function enhanceQueueItem(item: QueueItem): QueueItem {
  const templateFn = TEMPLATES[item.type];
  if (!templateFn) return item;

  const enhanced = templateFn({
    company: item.company,
    jobTitle: item.jobTitle,
    priority: item.priority,
  });

  return { ...item, description: enhanced };
}

/**
 * Enhances a full queue in one pass.
 * Keeps the sort order and deduplication already applied by the engine.
 */
export function enhanceQueue(items: QueueItem[]): QueueItem[] {
  return items.map(enhanceQueueItem);
}
