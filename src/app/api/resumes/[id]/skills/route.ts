import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getResume, updateResume } from '@/lib/resume-builder/documents';
import { z } from 'zod';

const bodySchema = z.object({
  skill: z.string().trim().min(1).max(80),
});

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(
        `resumes:skills:${userId}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) return apiError('RATE_LIMITED', 'Too many requests.', { request });

      let parsed: z.infer<typeof bodySchema>;
      try {
        parsed = bodySchema.parse(await request.json());
      } catch {
        return apiError('VALIDATION_FAILED', 'Invalid skill payload.', { request });
      }

      const resume = await getResume({ userId, resumeId: id });
      const content = resume.content as { skills?: Array<{ id: string; name: string; category?: string; origin?: string }> };
      const skills = content.skills ?? [];
      const normalized = parsed.skill.trim();
      if (skills.some((skill) => skill.name.toLowerCase() === normalized.toLowerCase())) {
        return jsonOk({ ok: true, added: false }, request);
      }

      const nextSkills = [
        ...skills,
        { id: `skill-${Date.now()}`, name: normalized, origin: 'USER' },
      ];

      await updateResume({
        userId,
        resumeId: id,
        input: {
          expectedRevision: resume.revision,
          content: { ...resume.content, skills: nextSkills } as typeof resume.content,
        },
      });

      return jsonOk({ ok: true, added: true }, request);
    },
    { event: 'resume_skill_add_failed', route: '/api/resumes/[id]/skills' },
  );
}
