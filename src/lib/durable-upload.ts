import fs from 'fs/promises';
import path from 'path';
import { del, put } from '@vercel/blob';

type AssetKind = 'resume' | 'avatar';

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
 * Avatars stay public: they are rendered directly via `<img src>` throughout the
 * app, so privatising them would require proxying every render for little
 * confidentiality gain.
 */
const BLOB_ACCESS: Record<AssetKind, 'public' | 'private'> = {
  resume: 'private',
  avatar: 'public',
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

function isBlobUrl(url: string): boolean {
  return url.includes('blob.vercel-storage.com');
}

function isLocalUploadUrl(url: string): boolean {
  return url.startsWith('/uploads/');
}

/**
 * True when a stored asset URL is a Vercel Blob that requires authenticated
 * (token-gated) delivery rather than a public fetch.
 *
 * Vercel Blob private objects are served from a `.private` subdomain, so this
 * distinguishes them from legacy public uploads without an extra API call.
 * Local dev uploads under `/uploads/` are neither.
 */
export function isPrivateResumeUrl(url: string): boolean {
  if (!isBlobUrl(url)) return false;
  return url.includes('.private.blob.vercel-storage.com') || url.includes('private/');
}

export async function deleteStoredAsset(url: string | null | undefined): Promise<void> {
  if (!url) return;

  if (isBlobUrl(url) && hasBlobToken()) {
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
    const blob = await put(pathname, file, {
      access: BLOB_ACCESS[kind],
      addRandomSuffix: false,
    });

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