/**
 * Resume documents and private-file access.
 *
 * The single rule this module enforces: a resume is only ever read on behalf of
 * the user who owns it. Ownership comes from the session, never from a
 * request parameter, so there is no identifier a caller can swap to reach
 * someone else's document.
 *
 * Resumes stay PRIVATE. They are stored as token-gated Vercel blobs and fetched
 * server-to-server; the browser never receives a storage URL it could reuse.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { isPrivateResumeUrl } from '@/lib/durable-upload';
import { logImportantError } from '@/lib/observability';
import {
  RESUME_MAX_FILE_BYTES,
  RESUME_STORAGE_FETCH_TIMEOUT_MS,
  type ResumeFormat,
} from './limits';

export type ResumeDocumentRecord = {
  id: string;
  userId: string;
  url: string;
  fileName: string;
  format: string;
  sizeBytes: number;
  isPrimary: boolean;
  createdAt: Date;
};

export class ResumeDocumentNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor() {
    // Deliberately identical whether the document is missing or belongs to
    // someone else. Revealing the difference would confirm that another user's
    // private resume exists.
    super('Resume not found.');
    this.name = 'ResumeDocumentNotFoundError';
  }
}

export class ResumeStorageError extends Error {
  readonly code = 'STORAGE_UNAVAILABLE';
  readonly status = 503;

  constructor(message = 'We could not open your stored resume. Please upload it again.') {
    super(message);
    this.name = 'ResumeStorageError';
  }
}

/** Only ever accept storage URLs this application created. */
function isTrustedStorageUrl(url: string): boolean {
  if (url.startsWith('/uploads/')) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'blob.vercel-storage.com' || parsed.hostname.endsWith('.blob.vercel-storage.com'))
    );
  } catch {
    return false;
  }
}

/**
 * Read the local dev upload directory without allowing traversal.
 *
 * `path.join` alone is not enough: `..` segments are resolved by the OS. The
 * resolved path is compared against the resolved base so a crafted name cannot
 * escape, and symlink-free traversal is guaranteed by that comparison alone.
 */
async function readLocalUpload(relativeUrl: string): Promise<Uint8Array> {
  const baseDir = path.resolve(process.cwd(), 'public', 'uploads');
  const resolved = path.resolve(baseDir, relativeUrl.replace(/^\/uploads\//, ''));

  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new ResumeStorageError();
  }

  const handle = await fs.open(resolved, 'r').catch(() => {
    throw new ResumeStorageError();
  });
  try {
    const stat = await handle.stat();
    if (stat.size > RESUME_MAX_FILE_BYTES) {
      throw new ResumeStorageError('That stored resume is too large to analyze.');
    }
    const buffer = await handle.readFile();
    return new Uint8Array(buffer);
  } finally {
    await handle.close();
  }
}

async function readBlob(url: string, requiresAuth: boolean): Promise<Uint8Array> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (requiresAuth && !token) throw new ResumeStorageError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESUME_STORAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      // Private blobs require the store token; the browser never sees this URL.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new ResumeStorageError();

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > RESUME_MAX_FILE_BYTES) {
      throw new ResumeStorageError('That stored resume is too large to analyze.');
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    // Trust the measurement, not the header.
    if (buffer.length > RESUME_MAX_FILE_BYTES) {
      throw new ResumeStorageError('That stored resume is too large to analyze.');
    }
    return buffer;
  } catch (error) {
    if (error instanceof ResumeStorageError) throw error;
    throw new ResumeStorageError();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load a document the given user owns, together with its bytes.
 *
 * The `where` clause is `{ id, userId }`, not `{ id }` followed by a check:
 * a document belonging to another user is indistinguishable from one that does
 * not exist.
 */
export async function loadOwnedResumeDocument(params: {
  userId: string;
  resumeId: string;
}): Promise<{ document: ResumeDocumentRecord; bytes: Uint8Array }> {
  const document = await prisma.resumeDocument.findFirst({
    where: { id: params.resumeId, userId: params.userId },
  });
  if (!document) throw new ResumeDocumentNotFoundError();

  if (!isTrustedStorageUrl(document.url)) {
    throw new ResumeStorageError();
  }

  const bytes = document.url.startsWith('/uploads/')
    ? await readLocalUpload(document.url)
    : await readBlob(document.url, isPrivateResumeUrl(document.url));

  return { document, bytes };
}

export async function listResumeDocuments(userId: string): Promise<ResumeDocumentRecord[]> {
  return prisma.resumeDocument.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * The document a user most likely means by "my resume".
 *
 * Prefers the document flagged primary, then the most recently created one.
 * This is a convenience default, not an authorisation decision — the user can
 * always pick a different document to analyse.
 */
export async function getPrimaryResumeDocument(
  userId: string,
): Promise<ResumeDocumentRecord | null> {
  return prisma.resumeDocument.findFirst({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Record a freshly uploaded resume as a real document.
 *
 * Storage names are generated server-side by `uploadUserAsset`; the display name
 * is sanitised here and is never used as a path or an access-control value.
 */
export async function recordResumeDocument(params: {
  userId: string;
  url: string;
  fileName: string;
  format: ResumeFormat;
  sizeBytes: number;
  makePrimary: boolean;
}): Promise<ResumeDocumentRecord> {
  const safeName = sanitizeDisplayName(params.fileName);

  if (params.makePrimary) {
    await prisma.resumeDocument.updateMany({
      where: { userId: params.userId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  // A re-upload of the same stored URL updates in place rather than stacking up
  // duplicate rows for what is genuinely the same document.
  const existing = await prisma.resumeDocument.findFirst({
    where: { userId: params.userId, url: params.url },
  });

  if (existing) {
    return prisma.resumeDocument.update({
      where: { id: existing.id },
      data: {
        fileName: safeName,
        format: params.format,
        sizeBytes: params.sizeBytes,
        isPrimary: params.makePrimary || existing.isPrimary,
      },
    });
  }

  return prisma.resumeDocument.create({
    data: {
      userId: params.userId,
      url: params.url,
      fileName: safeName,
      format: params.format,
      sizeBytes: params.sizeBytes,
      isPrimary: params.makePrimary,
    },
  });
}

/** Display-only sanitisation: no path separators, no traversal, bounded length. */
export function sanitizeDisplayName(name: string): string {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '')
    .replace(/^-+\.?-+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned || 'resume';
}

/** Stable content key for an extraction: same text + same contract, same hash. */
export function hashResumeText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Owning profile of a document, used to decide whether the document a user
 * pointed at is also the one their profile currently references.
 */
export async function getProfilePrimaryResumeUrl(userId: string): Promise<string | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { resumeUrl: true },
  });
  return profile?.resumeUrl ?? null;
}

export async function logResumeStorageFailure(params: {
  userId: string;
  resumeId: string;
  error: unknown;
}): Promise<void> {
  await logImportantError({
    event: 'resume_storage_read_failed',
    userId: params.userId,
    route: '/api/resume/intelligence',
    error: params.error,
    context: { resumeId: params.resumeId },
  });
}