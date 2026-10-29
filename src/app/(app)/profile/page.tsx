'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, ExternalLink, Loader, X, Camera, Trash2 } from 'lucide-react';
import { useJobs } from '@/hooks/use-job-data';
import { ResumeAnalysisCta } from '@/components/resume/resume-analysis-cta';
import {
  RESUME_ACCEPT_ATTRIBUTE,
  RESUME_MAX_FILE_BYTES,
  formatAcceptLabel,
} from '@/lib/resume/limits';
import { profilePictureSrc } from '@/lib/profile-picture';

const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const MAX_RESUME_SIZE = RESUME_MAX_FILE_BYTES;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

// ─── Profile Picture ────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function ProfilePictureSection({
  currentUrl,
  name,
  onUpdated,
}: {
  currentUrl: string;
  name: string;
  onUpdated: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const displayUrl = profilePictureSrc(currentUrl);

  async function handleFile(f: File) {
    if (!ALLOWED_IMAGE_TYPES.has(f.type)) { setError('Only JPEG, PNG, WebP or GIF accepted.'); return; }
    if (f.size > MAX_IMAGE_SIZE) { setError('Image must be 4 MB or smaller.'); return; }
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('picture', f);
      const res = await fetch('/api/profile/picture', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Upload failed');
      onUpdated(json.profilePictureUrl ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setError('');
    setUploading(true);
    try {
      const res = await fetch('/api/profile/picture', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove picture');
      onUpdated('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove picture.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      {/* Avatar preview */}
      <div className="relative shrink-0">
        {displayUrl ? (
          <img src={displayUrl} alt={name} className="h-20 w-20 rounded-2xl object-cover ring-2 ring-white/10" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-accent/20 text-2xl font-bold text-accent-text ring-2 ring-accent/20">
            {getInitials(name)}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">
            <Loader className="h-5 w-5 animate-spin text-ink" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-sunken-hover hover:text-ink disabled:opacity-50"
          >
            <Camera className="h-3.5 w-3.5" />
            {currentUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {currentUrl && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => void handleRemove()}
              className="flex items-center gap-1.5 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger-text transition-colors hover:bg-danger/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted">JPEG, PNG, WebP or GIF · max 4 MB</p>
        {error && <p className="mt-1 text-xs text-danger-text">{error}</p>}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
    </div>
  );
}

// ─── Resume ─────────────────────────────────────────────────────────────────

function ResumeSection({
  resumeUrl,
  onChange,
}: {
  resumeUrl: string;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState(false);

  const fileName = resumeUrl ? resumeUrl.split('/').pop() ?? 'resume' : null;

  async function handleFile(f: File) {
    if (!ALLOWED_RESUME_TYPES.has(f.type)) { setError('Only PDF, DOCX, or TXT accepted.'); return; }
    if (f.size > MAX_RESUME_SIZE) { setError('File must be 5 MB or smaller.'); return; }
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('resume', f);
      const res = await fetch('/api/resume/parse', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Upload failed');
      onChange(json.resumeUrl ?? '');
      setReplacing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  if (resumeUrl && !replacing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-sunken px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-accent-text" />
          <span className="truncate text-sm text-ink">{fileName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href="/api/resume/file" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ExternalLink className="h-3.5 w-3.5" /> View
          </a>
          <button type="button" onClick={() => setReplacing(true)} className="rounded-lg border border-line bg-surface-sunken px-2.5 py-1 text-xs text-muted hover:text-ink">
            Replace
          </button>
          <button type="button" onClick={() => onChange('')} className="text-muted hover:text-danger-text" title="Remove">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-sunken px-4 py-4 text-sm text-muted transition-colors hover:border-accent/50 hover:bg-surface-sunken hover:text-ink disabled:opacity-60"
      >
        {uploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {uploading ? 'Uploading…' : resumeUrl ? 'Choose replacement file' : `Upload resume (${formatAcceptLabel()})`}
      </button>
      {replacing && (
        <button type="button" onClick={() => setReplacing(false)} className="mt-2 text-xs text-muted hover:text-ink">Cancel</button>
      )}
      {error && <p className="mt-1.5 text-xs text-danger-text">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept={RESUME_ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { profile, saveProfile } = useJobs();
  const [form, setForm] = useState({
    fullName: '',
    headline: '',
    portfolioUrl: '',
    githubUrl: '',
    linkedinUrl: '',
    resumeUrl: '',
  });
  const [profilePictureUrl, setProfilePictureUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setForm({
        fullName: profile.fullName || '',
        headline: profile.headline || '',
        portfolioUrl: profile.portfolioUrl || '',
        githubUrl: profile.githubUrl || '',
        linkedinUrl: profile.linkedinUrl || '',
        resumeUrl: profile.resumeUrl || '',
      });
      setProfilePictureUrl(profile.profilePictureUrl || '');
    }
  }, [profile]);

  async function handleSave() {
    setError(null);
    try {
      await saveProfile(form);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="title">Profile</h1>
        <p className="muted mt-1">Complete your candidate profile so the app feels personal and your templates/checklists have the right links.</p>
      </div>

      {/* Profile picture */}
      <div className="card-pad">
        <h2 className="mb-4 text-sm font-medium text-ink">Profile photo</h2>
        <ProfilePictureSection
          currentUrl={profilePictureUrl}
          name={form.fullName}
          onUpdated={setProfilePictureUrl}
        />
      </div>

      {/* Career profile — the analysis entry point sits with the resume it
          analyses, rather than behind a separate top-level destination. */}
      <ResumeAnalysisCta hasResume={Boolean(form.resumeUrl)} />

      {/* Text fields */}
      <div className="card-pad grid gap-4 md:grid-cols-2">
        <div><label className="mb-2 block text-sm text-muted">Full name</label><input className="input" value={form.fullName} onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))} /></div>
        <div><label className="mb-2 block text-sm text-muted">Headline</label><input className="input" value={form.headline} onChange={(e) => setForm((prev) => ({ ...prev, headline: e.target.value }))} placeholder="Full-Stack Software Engineer" /></div>
        <div><label className="mb-2 block text-sm text-muted">Portfolio URL</label><input className="input" value={form.portfolioUrl} onChange={(e) => setForm((prev) => ({ ...prev, portfolioUrl: e.target.value }))} placeholder="https://your-portfolio.example.com" /></div>
        <div><label className="mb-2 block text-sm text-muted">GitHub URL</label><input className="input" value={form.githubUrl} onChange={(e) => setForm((prev) => ({ ...prev, githubUrl: e.target.value }))} placeholder="https://github.com/your-handle" /></div>
        <div><label className="mb-2 block text-sm text-muted">LinkedIn URL</label><input className="input" value={form.linkedinUrl} onChange={(e) => setForm((prev) => ({ ...prev, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/your-handle" /></div>
        <div>
          <label className="mb-2 block text-sm text-muted">Resume</label>
          <ResumeSection resumeUrl={form.resumeUrl} onChange={(url) => setForm((prev) => ({ ...prev, resumeUrl: url }))} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void handleSave()}>Save profile</button>
        {saved ? <span className="text-sm text-success-text">Profile saved.</span> : null}
        {error ? <span className="text-sm text-danger-text">{error}</span> : null}
      </div>
    </div>
  );
}
