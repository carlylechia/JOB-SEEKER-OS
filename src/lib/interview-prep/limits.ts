/**
 * Centralised limits for interview preparation.
 *
 * One place decides how much job text, profile context and research material
 * we send to the provider, how many questions/tasks a pack may contain, how
 * long an answer may be, and how long any single external call may run.
 * Components import from here for client-side hints; the server re-checks
 * every limit independently.
 */

import { JOB_INTELLIGENCE_MAX_JOB_CHARS, JOB_INTELLIGENCE_MIN_JOB_CHARS } from '../job-intelligence/limits';

/** Ceiling on job text sent to the provider for pack generation. */
export const INTERVIEW_PREP_MAX_JOB_CHARS = JOB_INTELLIGENCE_MAX_JOB_CHARS;

/** Ceiling on career-profile context in the same prompt. */
export const INTERVIEW_PREP_MAX_PROFILE_CHARS = 9_000;

/** Ceiling on resume text used as fallback evidence. */
export const INTERVIEW_PREP_MAX_RESUME_CHARS = 6_000;

/** Minimum meaningful job text before a pack is worth generating. */
export const INTERVIEW_PREP_MIN_JOB_CHARS = JOB_INTELLIGENCE_MIN_JOB_CHARS;

/** Minimum manual role notes, so a pack is never generated from a title alone. */
export const INTERVIEW_PREP_MIN_MANUAL_CHARS = 80;

/**
 * Maximum questions in a pack. Relevance over volume: a practical bank is
 * 12–20 questions, never an undifferentiated dump.
 */
export const INTERVIEW_PREP_MAX_QUESTIONS = 20;
export const INTERVIEW_PREP_MIN_USEFUL_QUESTIONS = 6;

/** Maximum follow-up questions attached to any one question. */
export const INTERVIEW_PREP_MAX_FOLLOW_UPS = 3;

/** Maximum questions the candidate may ask the employer. */
export const INTERVIEW_PREP_MAX_EMPLOYER_QUESTIONS = 8;

/** Maximum concrete preparation tasks in a plan. */
export const INTERVIEW_PREP_MAX_TASKS = 10;
export const INTERVIEW_PREP_MIN_TASKS = 4;

/** Maximum company research sources retained for one pack. */
export const INTERVIEW_PREP_MAX_SOURCES = 8;

/** How much extracted text from one research page is kept/sent. */
export const INTERVIEW_PREP_MAX_SOURCE_TEXT_CHARS = 6_000;
export const INTERVIEW_PREP_MAX_SOURCE_EXCERPT_CHARS = 1_200;

/** Research fetch budget. Bounded so generation stays inside one function. */
export const INTERVIEW_PREP_MAX_RESEARCH_URLS = 4;
export const INTERVIEW_PREP_RESEARCH_TIMEOUT_MS = 6_000;
export const INTERVIEW_PREP_RESEARCH_TOTAL_BUDGET_MS = 15_000;
export const INTERVIEW_PREP_MAX_RESEARCH_BYTES = 512 * 1024;
export const INTERVIEW_PREP_MAX_REDIRECTS = 3;

/** Ceiling on a practice answer. */
export const INTERVIEW_PREP_MAX_ANSWER_CHARS = 4_000;

/** Minimum answer length before feedback is meaningful. */
export const INTERVIEW_PREP_MIN_ANSWER_CHARS = 30;

/** Provider call ceiling, matching the other AI features' serverless budget. */
export const INTERVIEW_PREP_AI_TIMEOUT_MS = 45_000;

/** How long a pack row may sit mid-generation before another request may take it over. */
export const INTERVIEW_PREP_PROCESSING_STALE_MS = 2 * 60 * 1000;

/** Maximum preparation guidance length. */
export const INTERVIEW_PREP_MAX_GUIDANCE_CHARS = 1_200;

/** User-supplied metadata ceilings. */
export const INTERVIEW_PREP_MAX_TITLE_CHARS = 160;
export const INTERVIEW_PREP_MAX_COMPANY_CHARS = 160;
export const INTERVIEW_PREP_MAX_ROLE_CHARS = 200;
export const INTERVIEW_PREP_MAX_LOCATION_CHARS = 200;
export const INTERVIEW_PREP_MAX_URL_CHARS = 2_048;
export const INTERVIEW_PREP_MAX_INTERVIEWER_INFO_CHARS = 2_000;
export const INTERVIEW_PREP_MAX_NOTES_CHARS = 2_000;
export const INTERVIEW_PREP_MAX_CONCERNS_CHARS = 1_200;
export const INTERVIEW_PREP_MAX_FOCUS_TOPICS = 8;
export const INTERVIEW_PREP_MAX_FOCUS_TOPIC_CHARS = 120;
export const INTERVIEW_PREP_MAX_LANGUAGE_CHARS = 80;

/** Maximum attempts loaded for a single practice question view. */
export const INTERVIEW_PREP_MAX_ATTEMPT_HISTORY = 10;

/** Timeout for fetching a job URL during manual import. */
export const INTERVIEW_PREP_JOB_URL_TIMEOUT_MS = 8_000;
