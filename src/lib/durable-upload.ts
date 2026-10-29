import fs from 'fs/promises';
import path from 'path';
import { del, put } from '@vercel/blob';
import {
  isPrivateVercelBlobUrl,
  isVercelBlobUrl,
} from './blob-url';

type AssetKind = 'resume' | 'avatar';

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

export async function deleteStoredAsset(url: string | null | undefined): Promise<void> {
  if (!url) return;

  if (isVercelBlobUrl(url) && hasBlobToken()) {
    await del(url).catch(() => undefined);
    return;
  }

  if (isLocalUploadUrl(url)) {
    const filePath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
    await fs.unlink(filePath).catch(() => undefined);
  }
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
  const safeExt = sanitizeFilenamePart(ext) || 'bin';
  const safeOriginalBase = sanitizeFilenamePart(file.name.replace(/\.[^.]+$/, '')) || kind;

  if (hasBlobToken()) {
    const pathname = `${config.blobPrefix}/${userId}/${Date.now()}-${safeOriginalBase}.${safeExt}`;
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

    await deleteStoredAsset(existingUrl);
    return blob.url;
  }

  assertProductionStorageConfig();

  await fs.mkdir(config.localDir, { recursive: true });
  const fileName = `${userId}-${Date.now()}-${safeOriginalBase}.${safeExt}`;
  const filePath = path.join(config.localDir, fileName);
  const bytes = await file.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(bytes));

  await deleteStoredAsset(existingUrl);
  return `${config.localUrlPrefix}/${fileName}`;
}