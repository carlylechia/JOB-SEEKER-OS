/**
 * One-page resume selection and measured layout.
 *
 * Selection is deterministic: it ranks the candidate's existing structured
 * facts against an optional owned job and never manufactures or truncates a
 * claim. When the user opts into job-specific AI, only operations already
 * accepted by the resume optimizer's evidence verifier are eligible here.
 */

import { z } from 'zod';
import { buildResumeLayout, renderResumePdf } from './serve';
import { resumeContentSchema, templateKeySchema, pageSizeSchema, type ResumeContent } from './schema';
import {
  DEFAULT_PAGE_SIZE,
  ONE_PAGE_MARGINS,
  isPageSizeKey,
  isTemplateKey,
  type PageSizeKey,
  type TemplateKey,
} from './templates';
import { applyToContent } from './optimization/service';
import type { ReviewOperation } from './optimization/schema';
import { OnePageSelectionError } from './one-page-errors';

const selectedKeysSchema = z.array(z.string().min(1).max(240)).max(800);
const operationIdsSchema = z.array(z.string().min(1).max(64)).max(20);
const editedItemsSchema = z.record(z.string().min(1).max(240), z.string().trim().min(1).max(1200)).refine(
  (items) => Object.keys(items).length <= 100,
  'Edit no more than 100 resume items at a time.',
);

export const onePagePreviewRequestSchema = z
  .object({
    targetJobId: z.string().max(64).nullable().optional(),
    targetRole: z.string().trim().max(180).nullable().optional(),
    objective: z.string().trim().max(240).nullable().optional(),
    templateKey: templateKeySchema.optional(),
    pageSize: pageSizeSchema.optional(),
    includedKeys: selectedKeysSchema.optional(),
    acceptedOperationIds: operationIdsSchema.optional(),
    summaryOverride: z.string().max(2000).nullable().optional(),
    editedItems: editedItemsSchema.optional(),
    useAi: z.boolean().optional(),
  })
  .strict();

export const onePageSaveRequestSchema = onePagePreviewRequestSchema
  .extend({
    name: z.string().trim().min(1).max(120),
    expectedRevision: z.number().int().min(1),
  })
  .strict();

export type OnePageInput = z.infer<typeof onePagePreviewRequestSchema>;

export type OnePageItem = {
  key: string;
  section: string;
  label: string;
  text: string;
  included: boolean;
  reason: string | null;
  editable: boolean;
};

export type OnePageRewrite = {
  id: string;
  itemKey: string | null;
  section: string;
  originalText: string;
  proposedText: string;
  warnings: string[];
};

export type OnePageProposal = {
  content: ResumeContent;
  layout: Awaited<ReturnType<typeof buildResumeLayout>>;
  pageCount: number;
  measurementAttempts: number;
  canSave: boolean;
  templateKey: TemplateKey;
  pageSize: PageSizeKey;
  includedKeys: string[];
  items: OnePageItem[];
  rewrites: OnePageRewrite[];
  acceptedOperationIds: string[];
  warnings: string[];
  aiNotice: string | null;
};

type SelectionItem = {
  key: string;
  section: string;
  label: string;
  text: string;
  kind: 'summary' | 'headline' | 'role' | 'bullet' | 'technology' | 'skill' | 'education' | 'project' | 'credential';
  groupKey?: string;
  score: number;
  preferred: boolean;
};

const STOP_WORDS = new Set(
  'about above after again against all also and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours'.split(' '),
);

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? [])
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function toText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function scoreText(text: string, target: Set<string>, recency = 0, bonus = 0): number {
  const source = tokens(text);
  let matches = 0;
  for (const token of source) if (target.has(token)) matches += 1;
  const relevance = target.size > 0 ? (matches / Math.sqrt(target.size)) * 8 : 0;
  const verifiedOutcome = /\b\d[\d,.]*\s?(?:%|percent|ms|seconds?|minutes?|hours?|days?|users?|teams?|clients?|projects?)?\b/i.test(text) ? 0.75 : 0;
  return relevance + recency + bonus + verifiedOutcome;
}

function itemKey(section: string, id: string, field = '', index?: number): string {
  return [section, id, field, index === undefined ? '' : String(index)].filter(Boolean).join(':');
}

function collectItems(content: ResumeContent, target: Set<string>): SelectionItem[] {
  const items: SelectionItem[] = [];
  const add = (item: SelectionItem) => items.push(item);

  if (content.summary) {
    add({
      key: 'summary',
      section: 'Professional summary',
      label: 'Professional summary',
      text: content.summary,
      kind: 'summary',
      score: scoreText(content.summary, target, 0, content.summary.length <= 420 ? 2 : 0),
      preferred: content.summary.length <= 420,
    });
  }
  if (content.basics.headline) {
    add({
      key: 'headline',
      section: 'Headline',
      label: 'Professional headline',
      text: content.basics.headline,
      kind: 'headline',
      score: scoreText(content.basics.headline, target, 0, 2),
      preferred: true,
    });
  }

  content.experiences.forEach((entry, roleIndex) => {
    const recency = Math.max(0, 4 - roleIndex) * 1.2;
    const roleText = [entry.jobTitle, entry.company, entry.location].filter(Boolean).join(' · ');
    const roleKey = itemKey('experience', entry.id, 'role');
    add({
      key: roleKey,
      section: 'Experience',
      label: [entry.jobTitle, entry.company].filter(Boolean).join(' · ') || `Experience ${roleIndex + 1}`,
      text: [roleText, entry.startDate, entry.isCurrent ? 'Present' : entry.endDate].filter(Boolean).join(' · '),
      kind: 'role',
      groupKey: entry.id,
      score: scoreText(roleText, target, recency, 1),
      preferred: roleIndex < 4,
    });
    for (const [field, bullets, bonus] of [
      ['achievements', entry.achievements, 1.5],
      ['responsibilities', entry.responsibilities, 0],
    ] as const) {
      bullets.forEach((text, index) => {
        add({
          key: itemKey('experience', entry.id, field, index),
          section: 'Experience',
          label: `${entry.jobTitle || entry.company || 'Experience'} · ${field === 'achievements' ? 'Achievement' : 'Responsibility'} ${index + 1}`,
          text,
          kind: 'bullet',
          groupKey: entry.id,
          score: scoreText(text, target, recency, bonus),
          preferred: index < 2,
        });
      });
    }
    if (entry.technologies.length > 0) {
      const text = entry.technologies.join(', ');
      add({
        key: itemKey('experience', entry.id, 'technologies'),
        section: 'Experience',
        label: `${entry.jobTitle || entry.company || 'Experience'} · Technologies`,
        text,
        kind: 'technology',
        groupKey: entry.id,
        score: scoreText(text, target, recency, 0.5),
        preferred: roleIndex < 3,
      });
    }
  });

  content.skills.forEach((skill, index) => {
    add({
      key: itemKey('skill', skill.id),
      section: 'Skills',
      label: skill.name,
      text: skill.name,
      kind: 'skill',
      score: scoreText(skill.name, target, Math.max(0, 2 - index * 0.05), 0.5),
      preferred: index < 14,
    });
  });
  content.education.forEach((entry, index) => {
    const text = [entry.qualification, entry.fieldOfStudy, entry.institution, entry.details]
      .filter(Boolean)
      .join(' · ');
    add({
      key: itemKey('education', entry.id),
      section: 'Education',
      label: [entry.qualification, entry.institution].filter(Boolean).join(' · ') || `Education ${index + 1}`,
      text,
      kind: 'education',
      score: scoreText(text, target, Math.max(0, 2 - index), 1),
      preferred: index < (content.experiences.length < 2 ? 2 : 1),
    });
  });
  content.projects.forEach((entry, index) => {
    const text = [entry.name, entry.role, entry.description, ...entry.technologies, ...entry.results]
      .filter(Boolean)
      .join(' · ');
    add({
      key: itemKey('project', entry.id),
      section: 'Projects',
      label: entry.name || `Project ${index + 1}`,
      text,
      kind: 'project',
      score: scoreText(text, target, Math.max(0, 1 - index * 0.1), 1.25),
      preferred: index < 1,
    });
  });
  content.credentials.forEach((entry, index) => {
    const text = [entry.name, entry.issuer, entry.proficiency, entry.details]
      .filter(Boolean)
      .join(' · ');
    add({
      key: itemKey('credential', entry.id),
      section: 'Certifications & other credentials',
      label: entry.name,
      text,
      kind: 'credential',
      score: scoreText(text, target, Math.max(0, 1 - index * 0.1), 1),
      preferred: index < 2,
    });
  });
  return items;
}

function initialSelection(items: SelectionItem[], content: ResumeContent): Set<string> {
  const selected = new Set<string>();
  const choose = (item: SelectionItem | undefined) => { if (item) selected.add(item.key); };
  choose(items.find((item) => item.kind === 'headline'));

  const summary = items.find((item) => item.kind === 'summary');
  if (summary?.preferred) choose(summary);

  const roles = items.filter((item) => item.kind === 'role');
  const rankedRoles = [...roles].sort((a, b) => b.score - a.score);
  const chosenRoleIds = new Set(rankedRoles.slice(0, Math.min(4, Math.max(1, roles.length))).map((item) => item.groupKey));
  for (const role of roles) if (chosenRoleIds.has(role.groupKey)) choose(role);

  for (const roleId of chosenRoleIds) {
    const bullets = items
      .filter((item) => item.groupKey === roleId && item.kind === 'bullet')
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    bullets.forEach(choose);
    const technology = items.find((item) => item.groupKey === roleId && item.kind === 'technology');
    if (technology?.preferred) choose(technology);
  }

  for (const kind of ['skill', 'education', 'project', 'credential'] as const) {
    const cap = kind === 'skill' ? 14 : kind === 'education'
      ? content.experiences.length < 2 ? 2 : 1
      : kind === 'project' ? 1 : 2;
    // Rank every available item. A high-relevance skill or credential later
    // in the source list can outrank a low-relevance early entry for a target.
    items.filter((item) => item.kind === kind)
      .sort((a, b) => b.score - a.score)
      .slice(0, cap)
      .forEach(choose);
  }
  return selected;
}

function contentFromKeys(
  content: ResumeContent,
  selected: Set<string>,
  summaryOverride?: string | null,
  textOverrides: Record<string, string> = {},
): ResumeContent {
  const experiences = content.experiences.flatMap((entry) => {
    const roleKey = itemKey('experience', entry.id, 'role');
    const responsibilities = entry.responsibilities.flatMap((text, index) => {
      const key = itemKey('experience', entry.id, 'responsibilities', index);
      return selected.has(key) ? [textOverrides[key]?.trim() || text] : [];
    });
    const achievements = entry.achievements.flatMap((text, index) => {
      const key = itemKey('experience', entry.id, 'achievements', index);
      return selected.has(key) ? [textOverrides[key]?.trim() || text] : [];
    });
    const technologies = selected.has(itemKey('experience', entry.id, 'technologies'))
      ? entry.technologies
      : [];
    const keep = selected.has(roleKey) || responsibilities.length > 0 || achievements.length > 0 || technologies.length > 0;
    return keep ? [{ ...entry, responsibilities, achievements, technologies }] : [];
  });

  return resumeContentSchema.parse({
    basics: content.basics,
    summary: summaryOverride !== undefined
      ? (summaryOverride?.trim() || null)
      : selected.has('summary') ? content.summary : null,
    experiences,
    skills: content.skills.filter((skill) => selected.has(itemKey('skill', skill.id))),
    education: content.education.filter((entry) => selected.has(itemKey('education', entry.id))),
    projects: content.projects.filter((entry) => selected.has(itemKey('project', entry.id))),
    credentials: content.credentials.filter((entry) => selected.has(itemKey('credential', entry.id))),
  });
}

function reviewReason(item: SelectionItem, targetAvailable: boolean): string {
  return targetAvailable
    ? 'Lower relevance to the selected role than the content retained.'
    : 'Lower priority for a concise general resume.';
}

function pruneSelection(items: SelectionItem[], selected: Set<string>): Set<string> {
  const next = new Set(selected);
  const optional = items
    .filter((item) => next.has(item.key) && item.kind !== 'role')
    .sort((a, b) => a.score - b.score);
  if (optional.length > 0) {
    for (const item of optional.slice(0, Math.max(1, Math.ceil(optional.length * 0.3)))) {
      next.delete(item.key);
    }
    return next;
  }

  const roles = items.filter((item) => item.kind === 'role' && next.has(item.key)).sort((a, b) => a.score - b.score);
  if (roles.length > 1) {
    const removeRole = roles[0].groupKey;
    for (const item of items) if (item.groupKey === removeRole) next.delete(item.key);
  }
  return next;
}

function operationItemKey(operation: ReviewOperation, source: ResumeContent): string | null {
  if (operation.kind === 'REPLACE_SUMMARY') return 'summary';
  if (operation.kind === 'REWRITE_HEADLINE') return 'headline';
  if (operation.kind !== 'REWRITE_BULLET' || operation.entryIndex === null || operation.bulletIndex === null) return null;
  if (operation.section === 'EXPERIENCE') {
    const entry = source.experiences[operation.entryIndex];
    if (!entry || (operation.field !== 'responsibilities' && operation.field !== 'achievements')) return null;
    return itemKey('experience', entry.id, operation.field, operation.bulletIndex);
  }
  if (operation.section === 'PROJECTS') {
    const entry = source.projects[operation.entryIndex];
    if (!entry) return null;
    return itemKey('project', entry.id);
  }
  return null;
}

/**
 * Make a proposal from server-owned, validated source content. The user can
 * supply explicit item keys to restore or remove content; keys are re-resolved
 * against this source every time and unknown values fail closed.
 */
export async function buildOnePageProposal(params: {
  source: ResumeContent;
  target: { title: string; company: string; jobDescription: string | null } | null;
  targetRole?: string | null;
  objective?: string | null;
  templateKey?: string;
  pageSize?: string;
  includedKeys?: string[];
  acceptedOperationIds?: string[];
  summaryOverride?: string | null;
  editedItems?: Record<string, string>;
  operations?: ReviewOperation[];
  aiNotice?: string | null;
}): Promise<OnePageProposal> {
  const source = resumeContentSchema.parse(params.source);
  const templateKey: TemplateKey = isTemplateKey(params.templateKey) ? params.templateKey : 'classic-ats';
  const pageSize: PageSizeKey = isPageSizeKey(params.pageSize) ? params.pageSize : DEFAULT_PAGE_SIZE;
  const targetText = [
    params.target?.title,
    params.target?.company,
    params.target?.jobDescription?.slice(0, 12_000),
    params.targetRole,
    params.objective,
  ].filter(Boolean).join(' ');
  const targetTokens = tokens(targetText);
  const operations = (params.operations ?? []).filter((operation) =>
    operation.kind === 'REPLACE_SUMMARY' || operation.kind === 'REWRITE_HEADLINE' || operation.kind === 'REWRITE_BULLET',
  );
  const operationKeys = new Map<string, string>();
  for (const operation of operations) {
    const key = operationItemKey(operation, source);
    if (key) operationKeys.set(operation.id, key);
  }
  const requestedOperations = params.acceptedOperationIds ?? [];
  if (requestedOperations.some((id) => !operationKeys.has(id))) {
    throw new OnePageSelectionError('One or more selected AI suggestions are no longer available. Generate a fresh preview.');
  }

  const acceptedOperationIds = requestedOperations.filter((id) => operationKeys.has(id));
  const acceptedOperations = operations.filter((operation) => acceptedOperationIds.includes(operation.id));
  let content = acceptedOperations.length > 0
    ? applyToContent(source, acceptedOperations.map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        section: operation.section,
        entryIndex: operation.entryIndex,
        field: operation.field,
        bulletIndex: operation.bulletIndex,
        moveTo: operation.moveTo,
        proposedText: operation.proposedText,
      })))
    : structuredClone(source);

  const items = collectItems(content, targetTokens);
  const itemKeys = new Set(items.map((item) => item.key));
  const editableKeys = new Set(items.filter((item) => item.kind === 'bullet').map((item) => item.key));
  if (Object.keys(params.editedItems ?? {}).some((key) => !editableKeys.has(key))) {
    throw new OnePageSelectionError('One or more edited items are no longer available. Generate a fresh preview.');
  }
  let selected = params.includedKeys === undefined
    ? initialSelection(items, content)
    : new Set(params.includedKeys);
  for (const entry of content.experiences) {
    const roleKey = itemKey('experience', entry.id, 'role');
    if (items.some((item) => item.groupKey === entry.id && item.kind !== 'role' && selected.has(item.key))) {
      selected.add(roleKey);
    }
  }
  if (Array.from(selected).some((key) => !itemKeys.has(key))) {
    throw new OnePageSelectionError('A selected item no longer belongs to this resume. Generate a fresh preview.');
  }

  if (params.summaryOverride !== undefined) {
    selected.add('summary');
  }
  const attemptedSelection = new Set(selected);

  const warnings: string[] = [];
  let layout = await buildResumeLayout({
    content: contentFromKeys(content, selected, params.summaryOverride, params.editedItems),
    templateKey,
    pageSize,
    accentKey: 'charcoal',
    // The one-page policy uses the template's regular readable body size and
    // only a modest margin adjustment; it never squeezes text to force a fit.
    density: 0,
    margins: ONE_PAGE_MARGINS,
  });
  let rendered = await renderResumePdf(layout);
  let attempts = 1;
  while (rendered.pageCount !== 1 && attempts < 4) {
    const next = pruneSelection(items, selected);
    if (next.size === selected.size) break;
    selected = next;
    attempts += 1;
    layout = await buildResumeLayout({
      content: contentFromKeys(content, selected, params.summaryOverride, params.editedItems),
      templateKey,
      pageSize,
      accentKey: 'charcoal',
      density: 0,
      margins: ONE_PAGE_MARGINS,
    });
    rendered = await renderResumePdf(layout);
  }

  const candidate = contentFromKeys(content, selected, params.summaryOverride, params.editedItems);
  if (rendered.pageCount !== 1) {
    warnings.push('This content still needs more than one page with the minimum readable type and margins. Remove more lower-priority items or choose a shorter source before saving.');
  }
  if (candidate.summary && candidate.summary.length > 500) {
    warnings.push('The summary is still long for a one-page resume. Consider shortening it in the review.');
  }
  if (layout.warnings.length > 0) warnings.push(...layout.warnings.map((warning) => warning.message));
  if (params.target && !params.target.jobDescription?.trim()) {
    warnings.push('The selected job has no description saved. Selection used its title and company only.');
  }

  const reviewItems = items.map((item) => ({
    key: item.key,
    section: item.section,
    label: item.label,
    text: params.editedItems?.[item.key] ?? item.text,
    included: selected.has(item.key),
    editable: item.kind === 'bullet',
    reason: selected.has(item.key)
      ? null
      : attemptedSelection.has(item.key)
        ? 'Removed to meet the one-page layout while preserving readable type and margins.'
        : params.includedKeys !== undefined
          ? 'Not selected for this version. Restore it if you want it included.'
          : reviewReason(item, Boolean(params.target || params.targetRole)),
  }));

  const rewrites = operations.map((operation) => ({
    id: operation.id,
    itemKey: operationItemKey(operation, source),
    section: operation.sectionLabel,
    originalText: operation.originalText,
    proposedText: operation.proposedText,
    warnings: operation.warnings,
  }));

  return {
    content: candidate,
    layout,
    pageCount: rendered.pageCount,
    measurementAttempts: attempts,
    canSave: rendered.pageCount === 1,
    templateKey,
    pageSize,
    includedKeys: Array.from(selected),
    items: reviewItems,
    rewrites,
    acceptedOperationIds,
    warnings: [...new Set(warnings)],
    aiNotice: params.aiNotice ?? null,
  };
}
