'use client';

import { useRef, useState } from 'react';
import { Upload, X, Check } from 'lucide-react';
import { Linkedin } from 'lucide-react';

type Props = {
  profilePictureUrl: string;
  isLinkedinUser: boolean;
  linkedinPhotoUrl: string;
  name: string;
  onUrlChange: (url: string) => void;
};

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
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') onUrlChange(result);
    };
    reader.readAsDataURL(file);
  }

  function handleUrlSubmit() {
    const trimmed = urlInput.trim();
    if (trimmed) {
      onUrlChange(trimmed);
      setUrlInput('');
      setShowUrlInput(false);
    }
  }

  const hasLinkedinPhoto = isLinkedinUser && linkedinPhotoUrl;
  const isUsingLinkedinPhoto = profilePictureUrl === linkedinPhotoUrl && hasLinkedinPhoto;

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
        <div className="flex items-center gap-3 rounded-xl border border-[#0077b5]/40 bg-[#0077b5]/10 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={linkedinPhotoUrl}
            alt="LinkedIn profile"
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[#7ec8e3]">Use your LinkedIn profile photo?</p>
            <p className="truncate text-[11px] text-muted">We found a photo from your LinkedIn account.</p>
          </div>
          <button
            type="button"
            onClick={() => onUrlChange(linkedinPhotoUrl)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0077b5]/40 px-3 py-1.5 text-xs font-semibold text-[#7ec8e3] transition hover:bg-[#0077b5]/60"
          >
            <Check size={13} />
            Use it
          </button>
        </div>
      )}

      {/* Currently using LinkedIn photo banner */}
      {isUsingLinkedinPhoto && (
        <div className="flex items-center gap-2 rounded-xl border border-[#0077b5]/40 bg-[#0077b5]/10 px-4 py-2.5">
          <Linkedin size={14} className="shrink-0 text-[#0077b5]" />
          <p className="flex-1 text-xs text-[#7ec8e3]">Using your LinkedIn profile photo</p>
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
          {profilePictureUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profilePictureUrl}
                alt="Profile preview"
                className="h-28 w-28 rounded-full border-2 border-accent object-cover"
              />
              {!isUsingLinkedinPhoto && (
                <button
                  type="button"
                  onClick={() => onUrlChange('')}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/80 text-white hover:bg-red-500"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-white/20 bg-white/5 text-2xl font-bold text-muted">
              {name ? getInitials(name) : '?'}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {/* Upload from device */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Upload size={14} />
            Upload photo
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
            onClick={() => setShowUrlInput((v) => !v)}
            className="btn-secondary text-sm"
          >
            Paste URL
          </button>
        </div>

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
