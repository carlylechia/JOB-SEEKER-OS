import { before, describe, expect, it } from './harness';
import { buildOnePageProposal } from '@/lib/resume-builder/one-page';
import { ONE_PAGE_MARGINS, PAGE_SIZES, TEMPLATE_KEYS } from '@/lib/resume-builder/templates';
import { resumeContentSchema } from '@/lib/resume-builder/schema';
import { preparePdfEngine } from '@/lib/resume-builder/pdf';
import { longContent, typicalContent } from './resume-builder-fixtures';

before(async () => {
  await preparePdfEngine();
});

describe('one-page resume review', () => {
  it('measures typical content in all templates and both page sizes', async () => {
    const source = typicalContent();
    for (const templateKey of TEMPLATE_KEYS) {
      for (const pageSize of ['A4', 'LETTER'] as const) {
        const proposal = await buildOnePageProposal({ source, target: null, templateKey, pageSize });
        expect(proposal.canSave).toBe(true);
        expect(proposal.pageCount).toBe(1);
        expect(proposal.layout.pages).toHaveLength(1);
        expect(proposal.layout.pages[0].width).toBe(PAGE_SIZES[pageSize].width);
        expect(proposal.layout.margins).toEqual(ONE_PAGE_MARGINS);
        expect(proposal.layout.fontSize).toBeGreaterThanOrEqual(9.5);
      }
    }
  });

  it('ranks job-relevant content, preserves facts, and reports omissions', async () => {
    const original = typicalContent();
    const source = resumeContentSchema.parse({
      ...original,
      skills: [
        ...Array.from({ length: 15 }, (_, index) => ({ id: `skill-${index}`, name: `GeneralSkill${index}` })),
        { id: 'skill-rust', name: 'Rust' },
      ],
    });
    const sourceSnapshot = structuredClone(source);
    const proposal = await buildOnePageProposal({
      source,
      target: { title: 'Rust Platform Engineer', company: 'Northwind', jobDescription: 'Build services in Rust with Kafka.' },
      targetRole: null,
    });

    expect(proposal.canSave).toBe(true);
    expect(proposal.content.skills.some((skill) => skill.name === 'Rust')).toBe(true);
    expect(proposal.content.experiences.some((entry) => entry.company === 'Acme Payments Ltd')).toBe(true);
    expect(proposal.items.some((item) => !item.included && Boolean(item.reason))).toBe(true);
    expect(proposal.content.experiences.flatMap((entry) => entry.achievements)).toContain(
      'Reduced p99 checkout latency by 38% across three teams.',
    );
    expect(source).toEqual(sourceSnapshot);
  });

  it('never reports an oversized proposal as one page and bounds actual PDF measurements', async () => {
    const source = longContent(12);
    const initial = await buildOnePageProposal({ source, target: null });
    const allKeys = initial.items.map((item) => item.key);
    const forced = await buildOnePageProposal({ source, target: null, includedKeys: allKeys });

    expect(forced.measurementAttempts).toBeLessThanOrEqual(4);
    expect(forced.pageCount).toBe(forced.layout.pages.length);
    expect(forced.canSave).toBe(forced.pageCount === 1);
    if (forced.pageCount > 1) expect(forced.canSave).toBe(false);
  });

  it('applies user-reviewed edits only to selected existing bullets', async () => {
    const source = typicalContent();
    const first = await buildOnePageProposal({ source, target: null });
    const bullet = first.items.find((item) => item.editable && item.included);
    expect(bullet).toBeDefined();
    const edited = await buildOnePageProposal({
      source,
      target: null,
      includedKeys: first.includedKeys,
      editedItems: { [bullet!.key]: 'Built reliable payment services with TypeScript.' },
    });
    expect(edited.content.experiences.flatMap((entry) => [...entry.achievements, ...entry.responsibilities]))
      .toContain('Built reliable payment services with TypeScript.');
    expect(edited.content.experiences.flatMap((entry) => [...entry.achievements, ...entry.responsibilities]))
      .not.toContain(bullet!.text);
  });
});
