/**
 * Admin password recovery tests.
 *
 * This script is the only way back into an administrator account, so the
 * properties under test are the ones that must hold even when someone is in a
 * hurry and running it against production:
 *
 *  - it never creates an account
 *  - it never logs or echoes the password it was given
 *  - it refuses a password that bcrypt would silently truncate
 *  - it destroys any outstanding reset token, which would otherwise be a
 *    takeover path on the very account being recovered
 *  - it refuses to write a weak password to a privileged account
 *
 * The pure helpers are imported and exercised directly. The database paths are
 * exercised against a real user, because "did it actually update the row" is
 * the claim that matters.
 */

import bcrypt from 'bcryptjs';
import { describe, it, beforeEach, afterEach, expect } from './harness';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser } from './helpers';

// The script's exported surface is deliberately small: everything else runs at
// import time via main(), so the module is loaded for its helpers only.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.join(process.cwd(), 'scripts', 'set-admin-password.ts');
const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

const created: string[] = [];

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('npx', ['tsx', SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: TEST_URL },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

beforeEach(() => {
  if (!TEST_URL) throw new Error('DATABASE_URL is required for these tests');
});

afterEach(async () => {
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
});

describe('admin:password', () => {
  it('refuses to invent an account for an email that does not exist', async () => {
    const { status, stdout, stderr } = run(['definitely-not-a-real-account-xyz@example.test']);
    const output = stdout + stderr;
    expect(status).toBe(1);
    expect(output).toContain('No account exists');
    // It must say plainly that it does not create accounts, because that is
    // the whole point of the safety model.
    expect(output).toContain('never creates accounts');
  });

  it('rejects a malformed email before touching the database', () => {
    const { status, stderr } = run(['not-an-email']);
    expect(status).toBe(1);
    expect(stderr + '').toContain('not a valid email');
  });

  it('prints usage when given no arguments', () => {
    const { status, stdout, stderr } = run([]);
    expect(status).toBe(1);
    expect(stdout + stderr).toContain('Usage:');
  });

  it('sets a password on an existing account and never echoes it', async () => {
    const user = await createUser({ email: `pw-test-${Date.now()}@example.test` });
    created.push(user.id);

    const password = 'Correct-Horse-9-Battery';
    const { status, stdout, stderr } = run([user.email, password, '--promote']);

    expect(status).toBe(0);

    // The critical assertion: the supplied password must appear nowhere in the
    // output. A script that prints what you just typed is a script that leaks
    // into CI logs and shell scrollback.
    expect(stdout).not.toContain(password);
    expect(stderr).not.toContain(password);
    expect(stdout + stderr).toContain('not echoed back');

    // And it really worked.
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.role).toBe('ADMIN');
    expect(await bcrypt.compare(password, updated.passwordHash)).toBe(true);
  });

  it('generates a strong password when none is supplied, and shows it once', async () => {
    const user = await createUser({ email: `pw-gen-${Date.now()}@example.test` });
    created.push(user.id);

    const { status, stdout } = run([user.email, '--promote']);
    expect(status).toBe(0);

    const match = /Password \(shown once[^)]*\):\s*\n\s*\n\s*(\S+)/.exec(stdout);
    expect(match).not.toBeNull();

    const generated = match![1];
    expect(generated.length).toBeGreaterThanOrEqual(14);

    // Whatever it printed must be the actual working password.
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(generated, updated.passwordHash)).toBe(true);
  });

  it('leaves the role alone when --promote is not passed', async () => {
    const user = await createUser({ email: `pw-nopromote-${Date.now()}@example.test` });
    created.push(user.id);

    const { status } = run([user.email, 'Another-Good-Password-7']);
    expect(status).toBe(0);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.role).toBe('USER');
    expect(await bcrypt.compare('Another-Good-Password-7', updated.passwordHash)).toBe(true);
  });

  /**
   * The takeover path this closes: a reset token issued before the recovery
   * would still be redeemable afterwards, letting whoever holds it reset the
   * account we just recovered.
   */
  it('destroys any outstanding password-reset token', async () => {
    const user = await createUser({ email: `pw-token-${Date.now()}@example.test` });
    created.push(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: 'an-outstanding-token-from-before',
        passwordResetExpires: new Date(Date.now() + 3_600_000),
      },
    });

    const { status } = run([user.email, 'Fresh-Secure-Password-3']);
    expect(status).toBe(0);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.passwordResetToken).toBeNull();
    expect(updated.passwordResetExpires).toBeNull();
  });

  /**
   * These three run against a real account, because the script resolves the
   * account before it looks at the password — refusing early for an unknown
   * email is correct, and these are testing a different refusal.
   */
  it('refuses a password that bcrypt would silently truncate', async () => {
    const user = await createUser({ email: `pw-long-${Date.now()}@example.test` });
    created.push(user.id);

    // bcrypt ignores everything past 72 bytes, so accepting a longer password
    // would leave an admin believing they have more entropy than they do.
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const { status, stderr } = run([user.email, 'A'.repeat(80)]);
    expect(status).toBe(1);
    expect(stderr).toContain('bcrypt silently truncates');

    // The stored password must be untouched by a rejected attempt.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('refuses a password below the administrator minimum', async () => {
    const user = await createUser({ email: `pw-short-${Date.now()}@example.test` });
    created.push(user.id);

    const { status, stderr } = run([user.email, 'short']);
    expect(status).toBe(1);
    expect(stderr).toContain('too short');
  });

  it('refuses an obviously predictable password', async () => {
    const user = await createUser({ email: `pw-weak-${Date.now()}@example.test` });
    created.push(user.id);

    const { status, stderr } = run([user.email, 'password12345678']);
    expect(status).toBe(1);
    expect(stderr).toContain('too predictable');
  });

  it('refuses to promote an unknown account even with a good password', () => {
    const { status, stderr } = run(['ghost-promote@example.test', 'A-Very-Good-Password-1', '--promote']);
    expect(status).toBe(1);
    expect(stderr).toContain('No account exists');
  });

  it('does not create a user when the email is unknown', async () => {
    const before = await prisma.user.count();
    run(['ghost-account-should-not-exist@example.test']);
    expect(await prisma.user.count()).toBe(before);
  });
});