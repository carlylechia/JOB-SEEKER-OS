import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/register-schema';
import { seedUserWorkspace } from '@/lib/db-helpers';
import { logImportantError, logImportantInfo } from '@/lib/observability';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return Response.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
      },
    });

    await seedUserWorkspace(user.id);
    await logImportantInfo({ event: 'user_registered', userId: user.id, route: '/api/register' });

    return Response.json({ ok: true });
  } catch (error) {
    await logImportantError({ event: 'user_register_failed', route: '/api/register', error });
    return Response.json({ error: 'Unable to create account right now.' }, { status: 500 });
  }
}
