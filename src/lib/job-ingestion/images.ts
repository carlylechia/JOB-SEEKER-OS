/**
 * Server-side validation for screenshots uploaded to the job-capture flow.
 *
 * The browser already downscales images, but that is a convenience, not a
 * security control: a crafted request can send any bytes and claim any MIME
 * type. This module checks the declared data URL, the decoded byte length and
 * the file signature before anything reaches the AI provider.
 */

export const MAX_INGESTION_IMAGES = 3;
export const MAX_INGESTION_IMAGE_BYTES = 2_000_000;
export const MAX_INGESTION_IMAGE_TOTAL_BYTES = 4_500_000;

export type ValidatedImage = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  bytes: number;
};

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/;

function hasSignature(bytes: Uint8Array, mimeType: ValidatedImage['mimeType']) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function validateIngestionImages(values: string[] | undefined): ValidatedImage[] {
  const dataUrls = Array.isArray(values) ? values.filter(Boolean) : [];
  if (dataUrls.length > MAX_INGESTION_IMAGES) {
    throw new ImageValidationError(`Attach at most ${MAX_INGESTION_IMAGES} images.`);
  }

  const images: ValidatedImage[] = [];
  let totalBytes = 0;

  for (const dataUrl of dataUrls) {
    const match = dataUrl.match(DATA_URL_PATTERN);
    if (!match) {
      throw new ImageValidationError('Images must be JPEG, PNG or WebP.');
    }
    const mimeType = match[1] as ValidatedImage['mimeType'];
    const base64 = match[2].replace(/\s+/g, '');
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      throw new ImageValidationError('That image could not be read.');
    }
    if (bytes.length < 64) {
      throw new ImageValidationError('That image is too small to read.');
    }
    if (bytes.length > MAX_INGESTION_IMAGE_BYTES) {
      throw new ImageValidationError('Each image must be smaller than 2 MB after compression.');
    }
    if (!hasSignature(bytes, mimeType)) {
      throw new ImageValidationError('The image content does not match its file type.');
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_INGESTION_IMAGE_TOTAL_BYTES) {
      throw new ImageValidationError('Those images are too large together. Attach fewer screenshots.');
    }
    images.push({ mimeType, base64, bytes: bytes.length });
  }

  return images;
}

export function toDataUrl(image: ValidatedImage): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}
