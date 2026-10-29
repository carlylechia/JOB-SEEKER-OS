'use client';

import { useRef, useState } from 'react';
import { Check, Linkedin, Loader2, Upload, X } from 'lucide-react';
import { isVercelBlobUrl } from '@/lib/blob-url';
import { profilePictureSrc } from '@/lib/profile-picture';

type Props = {
  profilePictureUrl: string;
  isLinkedinUser: boolean;
  linkedinPhotoUrl: string;
  name: string;
  onUrlChange: (url: string) => void;
};

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function StepProfilePhoto({ profilePictureUrl, isLinkedinUser, linkedinPhotoUrl, name, onUrlChange }: Props) {
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow choosing the same file again after a failed upload.
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setUploadError('Only JPEG, PNG, WebP or GIF accepted.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setUploadError('Image must be 4 MB or smaller.');
      return;
    }

    setUploadError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('picture', file);
      const res = await fetch('/api/profile/picture', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.profilePictureUrl) {
        throw new Error(json?.error ?? 'Upload failed.');
      }
      onUrlChange(json.profilePictureUrl);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function handleUrlSubmit() {
    const trimmed = urlInput.trim();
    if (trimmed) {
      onUrlChange(trimmed);
      setUrlInput('');
      setShowUrlInput(false);
    }
  }

  async function handleRemovePhoto() {
    const previousUrl = profilePictureUrl;
    const isStored = isVercelBlobUrl(previousUrl) || previousUrl.startsWith('/uploads/');

    onUrlChange('');
    setUploadError('');
    if (!isStored) return;

    setUploading(true);
    try {
      const res = await fetch('/api/profile/picture', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove photo.');
    } catch (error) {
      // Keep the form in sync with what is still stored.
      onUrlChange(previousUrl);
      setUploadError(error instanceof Error ? error.message : 'Could not remove photo.');
    } finally {
      setUploading(false);
    }
  }

  const hasLinkedinPhoto = isLinkedinUser && linkedinPhotoUrl;
  const isUsingLinkedinPhoto = profilePictureUrl === linkedinPhotoUrl && hasLinkedinPhoto;
  const displayProfilePicture = profilePictureSrc(profilePictureUrl);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-3 text-5xl">📸</div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Add a profile photo</h2>
        <p className="mt-2 text-sm text-muted">
          A photo helps you stand out. You can always skip this step.
        </p>
      </div>

      {/* LinkedIn photo suggestion */}
      {hasLinkedinPhoto && !profilePictureUrl && (
        <div className="flex items-center gap-3 rounded-xl border border-[#0A66C2]/40 bg-[#0A66C2]/[0.06] px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={linkedinPhotoUrl}
            alt="LinkedIn profile"
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-info-text">Use your LinkedIn profile photo?</p>
            <p className="truncate text-[11px] text-muted">We found a photo from your LinkedIn account.</p>
          </div>
          <button
            type="button"
            onClick={() => onUrlChange(linkedinPhotoUrl)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0A66C2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0A66C2]/90"
          >
            <Check size={13} />
            Use it
          </button>
        </div>
      )}

      {/* Currently using LinkedIn photo banner */}
      {isUsingLinkedinPhoto && (
        <div className="flex items-center gap-2 rounded-xl border border-[#0A66C2]/40 bg-[#0A66C2]/[0.06] px-4 py-2.5">
          <Linkedin size={14} className="shrink-0 text-[#0A66C2]" />
          <p className="flex-1 text-xs text-info-text">Using your LinkedIn profile photo</p>
          <button
            type="button"
            onClick={() => onUrlChange('')}
            className="shrink-0 text-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Avatar preview */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          {displayProfilePicture ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayProfilePicture}
                alt="Profile preview"
                className="h-28 w-28 rounded-full border-2 border-accent object-cover"
              />
              {!isUsingLinkedinPhoto && (
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto()}
                  disabled={uploading}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-danger-solid text-white hover:bg-danger-solid/90 disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-line bg-surface-sunken text-2xl font-bold text-muted">
              {name ? getInitials(name) : '?'}
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {/* Upload from device */}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <Upload size={14} />
            {uploading ? 'Uploading…' : 'Upload photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Paste URL */}
          <button
            type="button"
            disabled={uploading}
            onClick={() => setShowUrlInput((v) => !v)}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            Paste URL
          </button>
        </div>

        {uploadError && (
          <p role="alert" className="text-center text-xs text-danger-text">
            {uploadError}
          </p>
        )}

        {/* URL input panel */}
        {showUrlInput && (
          <div className="flex w-full max-w-sm gap-2">
            <input
              className="input flex-1"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleUrlSubmit();
                }
              }}
            />
            <button type="button" className="btn-primary shrink-0" onClick={handleUrlSubmit}>
              Set
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
