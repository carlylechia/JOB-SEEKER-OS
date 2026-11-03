'use client';

import { useRef, useState } from 'react';
import { JobFormValues, JobIngestionResult } from '@/types';

const MAX_IMAGES = 3;
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1_600;

type UploadedImage = {
  id: string;
  name: string;
  dataUrl: string;
  bytes: number;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    image.src = url;
  });
}

/**
 * Downscale in the browser before upload.
 *
 * Screenshots from modern phones are often 4-8 MB. The server accepts at most
 * 2 MB per image, and the model does not need the extra pixels, so the image is
 * fitted into a 1600 px box and re-encoded as JPEG. The server still validates
 * the bytes; this is about bandwidth and cost, not trust.
 */
async function prepareImage(file: File): Promise<UploadedImage> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Use a JPEG, PNG or WebP screenshot.');
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error('Each original image must be smaller than 10 MB.');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not process that image.');
  // White background prevents transparent PNGs becoming black in JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const base64 = dataUrl.split(',')[1] ?? '';
  return {
    id: crypto.randomUUID(),
    name: file.name || 'screenshot.jpg',
    dataUrl,
    bytes: Math.round((base64.length * 3) / 4),
  };
}

export function JobIngestionForm({
  onApply,
}: {
  onApply: (prefill: Partial<JobFormValues>, result: JobIngestionResult) => void;
}) {
  const [jobUrl, setJobUrl] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobIngestionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setIsPreparingImages(true);
    try {
      const room = MAX_IMAGES - images.length;
      if (room <= 0) throw new Error(`Attach at most ${MAX_IMAGES} images.`);
      const selected = Array.from(files).slice(0, room);
      const prepared: UploadedImage[] = [];
      for (const file of selected) prepared.push(await prepareImage(file));
      setImages((current) => [...current, ...prepared].slice(0, MAX_IMAGES));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read that image.');
    } finally {
      setIsPreparingImages(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleParse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobUrl.trim() && !jobDescription.trim() && images.length === 0) {
      setError('Add a job URL, paste a description, or attach a screenshot.');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/ingest-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobUrl,
          jobDescription,
          images: images.map((image) => image.dataUrl),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.details?.join(', ') || payload.error || 'Unable to parse job input.');
      }

      setResult(payload as JobIngestionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse job input.');
      setResult(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset() {
    setJobUrl('');
    setJobDescription('');
    setImages([]);
    setResult(null);
    setError(null);
  }

  function applyResult() {
    if (!result) return;
    onApply(
      {
        ...result.prefill,
        ingestionMeta: {
          mode: result.sourceMode,
          aiUsed: result.ai.used,
          model: result.ai.model,
          images: result.imageCount,
          confidence: result.confidence,
          warnings: result.warnings ?? [],
          extractedAt: new Date().toISOString(),
        },
      },
      result,
    );
  }

  return (
    <div className="card-pad space-y-4">
      <div>
        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-accent-text">AI capture</div>
        <h3 className="mt-2 text-xl font-semibold">Paste a link, drop a screenshot, or paste the advert</h3>
        <p className="muted mt-2 text-sm leading-7">
          AI reads the posting and extracts the role, company, compensation, requirements, skills, company profile and any
          recruiter contact it can verify. Screenshots and job flyers work too. Review everything before saving.
        </p>
      </div>

      <form className="grid gap-4" onSubmit={handleParse}>
        <div>
          <label className="mb-2 block text-sm text-muted">Job URL</label>
          <input className="input" placeholder="https://company.com/careers/role" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Or paste the job description</label>
          <textarea className="input min-h-40" placeholder="Paste the job description here..." value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-muted">Or attach a screenshot / job flyer</label>
          <input
            ref={fileInputRef}
            className="block w-full cursor-pointer rounded-xl border border-dashed border-line bg-surface-sunken px-4 py-3 text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-sm file:text-accent-text"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => void handleFiles(e.target.files)}
            disabled={images.length >= MAX_IMAGES || isPreparingImages}
          />
          <p className="mt-1 text-xs text-muted">
            Up to {MAX_IMAGES} images. They are compressed in your browser before upload. {isPreparingImages ? 'Preparing…' : ''}
          </p>
          {images.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {images.map((image) => (
                <div key={image.id} className="overflow-hidden rounded-xl border border-line bg-surface-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.dataUrl} alt={image.name} className="h-28 w-full object-cover" />
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted">
                    <span className="truncate">{image.name}</span>
                    <button type="button" className="shrink-0 text-danger-text" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {error ? <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-text">{error}</div> : null}
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" disabled={isSubmitting || isPreparingImages} type="submit">
            {isSubmitting ? 'Reading the posting…' : 'Extract with AI'}
          </button>
          <button className="btn-secondary" type="button" onClick={reset}>
            Reset
          </button>
        </div>
      </form>

      {result ? (
        <div className="rounded-2xl border border-line bg-surface-sunken p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-accent/10 text-accent-text">Prefill ready</span>
            <span className="text-xs text-muted">Source: {result.sourceMode}</span>
            {result.ai.used ? (
              <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success-text">
                AI · {result.ai.model}
              </span>
            ) : (
              <span className="rounded-full border border-line px-2.5 py-1 text-xs text-muted">Parser fallback</span>
            )}
            {typeof result.confidence === 'number' ? (
              <span className="text-xs text-muted">Confidence: {Math.round(result.confidence * 100)}%</span>
            ) : null}
          </div>
          {result.prefill.title || result.prefill.company ? (
            <div className="mt-3 text-sm text-ink">
              <span className="font-semibold">{result.prefill.title || 'Untitled role'}</span>
              {result.prefill.company ? <span className="text-muted"> · {result.prefill.company}</span> : null}
              {result.prefill.location ? <span className="text-muted"> · {result.prefill.location}</span> : null}
            </div>
          ) : null}
          {result.signals.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.signals.map((signal) => (
                <span key={signal} className="inline-flex rounded-full border border-line bg-surface-sunken px-3 py-1 text-xs text-muted">
                  {signal}
                </span>
              ))}
            </div>
          ) : null}
          {result.warnings?.length ? (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          ) : null}
          <p className="mt-4 text-sm leading-7 text-muted">
            Review the extracted fields below, correct anything the posting did not state, then save the lead to your workspace.
          </p>
          <div className="mt-4">
            <button className="btn-primary" type="button" onClick={applyResult}>
              Use extracted fields
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
