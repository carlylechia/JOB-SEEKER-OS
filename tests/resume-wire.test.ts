import { describe, it, expect } from './harness';
import { serialiseResume, serialiseResumeDetail } from '@/lib/resume-builder/wire';
import {
  RESUME_SECTION_KEYS,
  emptyResumeContent,
} from '@/lib/resume-builder/schema';
import type { StructuredResumeRecord } from '@/lib/resume-builder/documents';

describe('resume wire serializers', () => {
  it('includes full content in the editor detail response', () => {
    const content = { ...emptyResumeContent(), summary: 'Persisted resume summary.' };
    const resume: StructuredResumeRecord = {
      id: 'resume-1',
      userId: 'user-1',
      name: 'Product Manager Resume',
      content,
      templateKey: 'classic-ats',
      pageSize: 'A4',
      accentKey: 'gold',
      density: 1,
      hiddenSections: [],
      sectionOrder: [...RESUME_SECTION_KEYS],
      revision: 4,
      targetJobId: null,
      sourceResumeId: null,
      origin: 'BUILDER',
      sourceProfileVersion: null,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      targetJob: null,
    };

    const summary = serialiseResume(resume);
    const detail = serialiseResumeDetail(resume);

    expect('content' in summary).toBe(false);
    expect(detail.content).toEqual(content);
    expect(detail.hasContent).toBe(true);
  });
});
