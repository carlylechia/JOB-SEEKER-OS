import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import LinkedIn from 'next-auth/providers/linkedin';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { logImportantInfo } from '@/lib/observability';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    LinkedIn({
      clientId: process.env.LINKEDIN_CLIENT_ID ?? '',
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
      authorization: { params: { scope: 'openid profile email' } },
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { id: true, email: true, passwordHash: true, name: true, emailVerified: true },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Block login for unverified accounts
        if (!user.emailVerified) {
          await logImportantInfo({
            event: 'login_blocked_unverified',
            userId: user.id,
            route: '/api/auth/callback/credentials',
            context: { email: user.email },
          });
          throw new Error('EMAIL_NOT_VERIFIED');
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email.split('@')[0],
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'linkedin') {
        const email = (profile?.email as string | undefined)?.toLowerCase();
        if (!email) return false;

        const existingUser = await prisma.user.findUnique({
          where: { email },
          select: { id: true, linkedinId: true, emailVerified: true, name: true },
        });

        if (existingUser) {
          const patch: Record<string, unknown> = {};
          if (!existingUser.linkedinId) patch.linkedinId = account.providerAccountId;
          if (!existingUser.emailVerified) patch.emailVerified = new Date();
          if (Object.keys(patch).length > 0) {
            await prisma.user.update({ where: { id: existingUser.id }, data: patch });
          }
          await logImportantInfo({
            event: 'linkedin_login',
            userId: existingUser.id,
            context: { email, linked: !existingUser.linkedinId },
          });
        } else {
          // New user via LinkedIn — create account with empty password
          const newUser = await prisma.user.create({
            data: {
              email,
              name: ((profile?.name as string | undefined) ?? email.split('@')[0]),
              passwordHash: '',
              linkedinId: account.providerAccountId,
              emailVerified: new Date(),
            },
          });
          await logImportantInfo({
            event: 'linkedin_login',
            userId: newUser.id,
            context: { email, newAccount: true },
          });
        }
        return true;
      }
      return true;
    },

    async jwt({ token, account, user }) {
      // Credentials flow — user object is returned from authorize()
      if (user?.id) {
        token.id = user.id;
      }
      // LinkedIn OAuth — resolve DB id from email
      if (account?.provider === 'linkedin' && token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email.toLowerCase() },
          select: { id: true },
        });
        if (dbUser) token.id = dbUser.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
