#!/usr/bin/env tsx
/**
 * Admin account recovery — set a password, and optionally promote, from the CLI.
 *
 *   npm run admin:password -- you@yourdomain.com            # generate + set
 *   npm run admin:password -- you@yourdomain.com --promote  # generate + set + ADMIN
 *   npm run admin:password -- you@yourdomain.com 'my-pass' --promote
 *
 * WHY THIS EXISTS
 *
 * There is deliberately no public route that can set a password or grant
 * ADMIN — no admin-registration endpoint, no "is admin?" signup field, no
 * admin email in client-side code. That is correct, and it means the only ways
 * in are the CLI or a password-reset email.
 *
 * The reset email was not a usable path: production `EMAIL_FROM` is
 * `onboarding@resend.dev`, and `resend.dev` is Resend's test domain, which
 * only ever delivers to the address registered on the Resend account itself.
 * Every other recipient is silently discarded. So an admin locked out of their
 * account had no way back in at all.
 *
 * This closes that gap without weakening anything: it is a server-side script
 * that requires direct database access, exactly like `admin:bootstrap`.
 *
 * SAFETY RULES THIS SCRIPT KEEPS
 *
 *  - The password is never written to a log, an exception, or stdout.
 *  - A generated password is shown ONCE, by this script, and never stored in
 *    plaintext. The database only ever receives a bcrypt hash.
 *  - Any outstanding password-reset token is destroyed. A token issued before
 *    this ran would otherwise still be redeemable, which would leave the very
 *    account we just recovered able to be taken over by whoever holds it.
 *  - bcrypt silently truncates at 72 BYTES. A longer password would appear
 *    stronger than it is, so anything over the limit is refused outright rather
 *    than quietly truncated.
 *  - The account must already exist. This never creates one.
 */

import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';

import { prisma } from '../src/lib/prisma';
import { logImportantInfo } from '../src/lib/observability';

/**
 * bcrypt cost factor. Must match registration (`bcrypt.hash(password, 12)`)
 * or existing hashes would need rehashing on next login for no benefit.
 */
const BCRYPT_ROUNDS = 12;

/**
 * Registration accepts 8 characters. An administrator account is held to a
 * higher bar, because compromising it compromises every user record.
 */
const MIN_PASSWORD_LENGTH = 14;

/**
 * bcrypt's hard limit, in bytes — not characters. A multi-byte character can
 * consume several bytes, so this is measured on the encoded length.
 */
const BCRYPT_MAX_BYTES = 72;

/**
 * Alphabet for generated passwords.
 *
 * Excludes characters that are easy to confuse when read off a screen or
 * copied by hand: 0/O, 1/l/I. Nothing that needs shell escaping either.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Generate a strong random password.
 *
 * 128 bits of entropy from a 57-character alphabet, which is far beyond brute
 * force. Uniform selection via `randomInt`, never `Math.random`.
 */
function generatePassword(length = 24): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

type Validated = { ok: true } | { ok: false; reason: string };

function validatePassword(password: string): Validated {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `too short — use at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  // Checked in bytes, because that is what bcrypt actually truncates on.
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) {
    return {
      ok: false,
      reason: `too long — bcrypt silently truncates at ${BCRYPT_MAX_BYTES} bytes, and this one is ${Buffer.byteLength(password, 'utf8')}`,
    };
  }
  if (/^password|^123456|^qwerty/i.test(password)) {
    return { ok: false, reason: 'too predictable — pick something less guessable' };
  }
  return { ok: true };
}

async function main() {
  const argv = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')));

  if (flags.has('--help') || flags.has('-h')) {
    console.log(`
  Set an account's password from the CLI, and optionally promote it to ADMIN.

    npm run admin:password -- <email> [password] [--promote]

    <email>     an existing account (this script never creates one)
    [password]  omit to have a strong one generated and printed once

    --promote   also set role = ADMIN in the same operation

  The password is never logged. A generated one is shown exactly once.
`);
    return;
  }

  const emailArg = argv[0];
  if (!emailArg) {
    console.error('\n  Usage: npm run admin:password -- <email> [password] [--promote]\n');
    process.exit(1);
  }

  const email = normalizeEmail(emailArg);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`\n  "${emailArg}" is not a valid email address.\n`);
    process.exit(1);
  }

  // ── Resolve the account before asking for a password ────────────────────
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });

  if (!user) {
    console.error(`\n  No account exists for ${email}.`);
    console.error('  This script never creates accounts. Register through the app first.\n');
    process.exit(1);
  }

  const supplied = argv[1];
  const generated = !supplied;
  const password = supplied ?? generatePassword();

  const validation = validatePassword(password);
  if (!validation.ok) {
    console.error(`\n  Password rejected: ${validation.reason}.`);
    console.error(`  Minimum is ${MIN_PASSWORD_LENGTH} characters, maximum ${BCRYPT_MAX_BYTES} bytes.\n`);
    process.exit(1);
  }

  const promote = flags.has('--promote');
  const newRole = promote ? 'ADMIN' : user.role;

  // ── One transaction ─────────────────────────────────────────────────────
  // The hash, the role change and the token revocation either all land or none
  // do. A partially applied recovery would be worse than a failed one.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        role: newRole,
        // Kill any outstanding reset token. One issued before this ran would
        // still be redeemable otherwise, and that is a takeover path.
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
  });

  // Never include the password in any log line.
  await logImportantInfo({
    event: 'admin_password_reset',
    userId: user.id,
    context: {
      email,
      role: newRole,
      previousRole: user.role,
      promoted: promote,
      generatedPassword: generated,
      method: 'cli',
    },
  });

  console.log(`\n  ${promote ? 'Promoted' : 'Updated'} ${email}`);
  console.log(`    Role:      ${user.role}${promote ? ` -> ${newRole}` : ' (unchanged)'}`);
  console.log(`    Verified:  ${user.emailVerified ? 'yes' : 'NO — they cannot sign in until verified'}`);

  if (generated) {
    console.log('');
    console.log('    Password (shown once, not stored anywhere in plain text):');
    console.log('');
    console.log(`      ${password}`);
    console.log('');
    console.log('    Copy it now. It cannot be retrieved again.');
  } else {
    console.log('    Password: set to the value you supplied (not echoed back).');
  }

  if (!user.emailVerified) {
    console.log('');
    console.log('    NOTE: this account has not verified its email address and cannot sign in yet.');
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('\n  Failed:', error instanceof Error ? error.message : error);
    console.error('  The password was NOT changed.\n');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });