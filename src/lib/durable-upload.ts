import fs from 'fs/promises';
import path from 'path';
import { del, put } from '@vercel/blob';
import {
  isPrivateVercelBlobUrl,
  isVercelBlobUrl,
} from './blob-url';

export type AssetKind = 'resume' | 'avatar';

export class ResumeBlobStoreConfigurationError extends Error {
  readonly status = 503;

  constructor() {
    super(
      'Resume storage is linked to a public Vercel Blob store. Switch BLOB_READ_WRITE_TOKEN to a private Blob store and redeploy; resumes cannot be uploaded publicly.',
    );
    this.name = 'ResumeBlobStoreConfigurationError';
  }
}

export class AvatarBlobStoreConfigurationError extends Error {
  readonly status = 503;

  constructor() {
    super(
      'Profile picture storage is linked to a public Vercel Blob store. Switch BLOB_READ_WRITE_TOKEN to a private Blob store and redeploy; profile pictures are stored privately.',
    );
    this.name = 'AvatarBlobStoreConfigurationError';
  }
}

const ASSET_CONFIG: Record<AssetKind, { blobPrefix: string; localDir: string; localUrlPrefix: string }> = {
  resume: {
    blobPrefix: 'resumes',
    localDir: path.join(process.cwd(), 'public', 'uploads', 'resumes'),
    localUrlPrefix: '/uploads/resumes',
  },
  avatar: {
    blobPrefix: 'avatars',
    localDir: path.join(process.cwd(), 'public', 'uploads', 'avatars'),
    localUrlPrefix: '/uploads/avatars',
  },
};

/**
 * Resumes contain personal data (name, contact details, employment history), so
 * they are stored as PRIVATE blobs and served only through the authenticated,
 * ownership-checked `/api/resume/file` route. Previously they were uploaded as
 * PUBLIC blobs, meaning anyone with the URL could read a user's resume.
 *
 * Avatars are private too. A Vercel Blob store has one access mode for every
 * upload, so a public avatar request against a private store fails outright.
 * Private avatars are served through `/api/profile/picture/file`, which resolves
 * the picture from the authenticated user's own profile.
 */
const BLOB_ACCESS: Record<AssetKind, 'public' | 'private'> = {
  resume: 'private',
  avatar: 'private',
};

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function safeUserId(userId: string): string {
  return sanitizeFilenamePart(userId) || 'user';
}

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function assertProductionStorageConfig() {
  if (process.env.NODE_ENV === 'production' && !hasBlobToken()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for durable uploads in production.');
  }
}

function isLocalUploadUrl(url: string): boolean {
  return url.startsWith('/uploads/');
}

/**
 * True when a stored asset URL is a Vercel Blob that requires authenticated
 * (token-gated) delivery rather than a public fetch.
 *
 * Kept as a resume-named export for the existing resume loader; the underlying
 * URL rule is shared so avatars and resumes cannot drift apart.
 */
export function isPrivateResumeUrl(url: string): boolean {
  return isPrivateVercelBlobUrl(url);
}

/**
 * True only when the URL belongs to this user's own namespace for this kind of
 * asset. Storage names are generated as `resumes/<userId>/…` or
 * `avatars/<userId>/…` for blobs, and `<userId>-…` for local uploads.
 *
 * Both deletion and private-file proxying must call this before touching
 * storage: a URL stored in a user-controlled column must never be able to
 * delete another tenant's object or fetch it with the store token.
 */
export type StoredAssetDeletion =
  | { status: 'deleted' }
  | { status: 'skipped'; reason: 'missing_url' | 'not_owned' }
  | { status: 'failed'; error: string };

export function isAssetKind(value: string): value is AssetKind {
  return value === 'resume' || value === 'avatar';
}

export function isOwnedStoredAssetUrl(
  url: string | null | undefined,
  owner: { kind: AssetKind; userId: string },
): boolean {
  if (!url) return false;
  const config = ASSET_CONFIG[owner.kind];
  const userId = safeUserId(owner.userId);

  if (isVercelBlobUrl(url)) {
    try {
      const pathname = new URL(url).pathname;
      return pathname.startsWith(`/${config.blobPrefix}/${userId}/`);
    } catch {
      return false;
    }
  }

  if (!isLocalUploadUrl(url)) return false;
  const clean = url.split(/[?#]/)[0];
  const prefix = `${config.localUrlPrefix}/`;
  if (!clean.startsWith(prefix)) return false;

  const fileName = clean.slice(prefix.length);
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return false;
  }
  return fileName.startsWith(`${userId}-`);
}

/**
 * Delete a stored asset and report whether cleanup actually happened.
 *
 * This is the variant destructive workflows should use: an external store can
 * fail independently of the database transaction, and callers must be able to
 * record an explicit retryable state instead of claiming complete deletion.
 *
 * Only server-stored URLs that belong to the owner's namespace are touched;
 * client-supplied URLs and shared assets are skipped.
 */
export async function deleteStoredAssetWithResult(
  url: string | null | undefined,
  owner: { kind: AssetKind; userId: string },
): Promise<StoredAssetDeletion> {
  if (!url) return { status: 'skipped', reason: 'missing_url' };
  if (!isOwnedStoredAssetUrl(url, owner)) return { status: 'skipped', reason: 'not_owned' };

  if (isVercelBlobUrl(url)) {
    if (!hasBlobToken()) {
      return { status: 'failed', error: 'blob_token_missing' };
    }
    try {
      await del(url);
      return { status: 'deleted' };
    } catch (error) {
      // A blob that is already gone is a successful cleanup. Keep the error
      // classification stable and free of URLs, headers or provider payloads.
      const name = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : '';
      if (/not found|404/i.test(message)) return { status: 'deleted' };
      return { status: 'failed', error: `blob_delete_failed:${name}` };
    }
  }

  if (!isLocalUploadUrl(url)) return { status: 'skipped', reason: 'not_owned' };

  // Defence in depth: even after the ownership check, resolve the path and
  // verify it is still inside public/uploads before unlinking.
  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads');
  const clean = url.split(/[?#]/)[0];
  const resolved = path.resolve(process.cwd(), 'public', clean.replace(/^\//, ''));
  if (resolved === uploadsRoot || !resolved.startsWith(uploadsRoot + path.sep)) {
    return { status: 'skipped', reason: 'not_owned' };
  }

  try {
    await fs.unlink(resolved);
    return { status: 'deleted' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { status: 'deleted' };
    return { status: 'failed', error: `local_unlink_failed:${code ?? 'unknown'}` };
  }
}

/** Best-effort compatibility wrapper for non-critical cleanup paths. */
export async function deleteStoredAsset(
  url: string | null | undefined,
  owner: { kind: AssetKind; userId: string },
): Promise<void> {
  await deleteStoredAssetWithResult(url, owner);
}

export async function uploadUserAsset(params: {
  kind: AssetKind;
  userId: string;
  file: File;
  ext: string;
  existingUrl?: string | null;
}): Promise<string> {
  const { kind, userId, file, ext, existingUrl } = params;
  const config = ASSET_CONFIG[kind];
  const owner = { kind, userId };
  const safeId = safeUserId(userId);
  const safeExt = sanitizeFilenamePart(ext) || 'bin';
  const safeOriginalBase = sanitizeFilenamePart(file.name.replace(/\.[^.]+$/, '')) || kind;

  if (hasBlobToken()) {
    const pathname = `${config.blobPrefix}/${safeId}/${Date.now()}-${safeOriginalBase}.${safeExt}`;
    let blob;
    try {
      blob = await put(pathname, file, {
        access: BLOB_ACCESS[kind],
        addRandomSuffix: false,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /cannot use private access on a public store/i.test(error.message)
      ) {
        throw kind === 'resume'
          ? new ResumeBlobStoreConfigurationError()
          : new AvatarBlobStoreConfigurationError();
      }
      throw error;
    }

    await deleteStoredAsset(existingUrl, owner);
    return blob.url;
  }

  assertProductionStorageConfig();

  await fs.mkdir(config.localDir, { recursive: true });
  const fileName = `${safeId}-${Date.now()}-${safeOriginalBase}.${safeExt}`;
  const filePath = path.join(config.localDir, fileName);
  const bytes = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(bytes));

  await deleteStoredAsset(existingUrl, owner);
  return `${config.localUrlPrefix}/${fileName}`;
}
