'use client';

import { useRef, useState } from 'react';
import { FileText, Upload, X, CheckCircle, AlertCircle, Loader, ExternalLink } from 'lucide-react';

type ExtractedData = {
  resumeUrl?: string;
  suggestedJobTitles?: string[];
  suggestedSkills?: string[];
  fullName?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
};

type Props = {
  resumeUrl?: string;
  onExtracted: (data: ExtractedData) => void;
};

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const MAX_SIZE = 5 * 1024 * 1024;

export function StepResume({ resumeUrl: initialResumeUrl, onExtracted }: Props) {
  const dropRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>(initialResumeUrl ? 'done' : 'idle');
  const [storedResumeUrl, setStoredResumeUrl] = useState<string>(initialResumeUrl ?? '');
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  function validateFile(f: File): string | null {
    if (!ALLOWED_TYPES.has(f.type)) return 'Only PDF, DOCX, or TXT files are accepted.';
    if (f.size > MAX_SIZE) return 'File must be 5 MB or smaller.';
    return null;
  }

  async function processFile(f: File) {
    const err = validateFile(f);
    if (err) {
      setErrorMsg(err);
      setUploadState('error');
      return;
    }

    setFile(f);
    setUploadState('uploading');
    setErrorMsg('');

    try {
      const formData = new FormData();
      formData.append('resume', f);

      const res = await fetch('/api/resume/parse', { method: 'POST', body: formData });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error ?? 'Parse failed');
      }

      const url: string = json.resumeUrl ?? '';
      setStoredResumeUrl(url);
      setUploadState('done');
      onExtracted({
        resumeUrl: url,
        suggestedJobTitles: json.extracted?.suggestedJobTitles ?? [],
        suggestedSkills: json.extracted?.suggestedSkills ?? [],
        fullName: json.extracted?.fullName,
        linkedinUrl: json.extracted?.linkedinUrl,
        githubUrl: json.extracted?.githubUrl,
        portfolioUrl: json.extracted?.portfolioUrl,
      });
    } catch (e) {
      setUploadState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Could not parse resume.');
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void processFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  }

  function reset() {
    setFile(null);
    setStoredResumeUrl('');
    setUploadState('idle');
    setErrorMsg('');
    if (fileRef.current) fileRef.current.value = '';
  }

  const displayName = file?.name ?? (storedResumeUrl ? storedResumeUrl.split('/').pop() : '');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-3 text-5xl">📄</div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Upload your resume</h2>
        <p className="mt-2 text-sm text-muted">
          We&apos;ll extract your skills and job titles to pre-fill the next step. PDF, DOCX, or TXT — max 5 MB.
        </p>
      </div>

      {/* Drop zone */}
      {uploadState === 'idle' && (
        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={[
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 transition-all',
            isDragging
              ? 'border-accent bg-accent/10'
              : 'border-white/15 bg-white/3 hover:border-white/30 hover:bg-white/5',
          ].join(' ')}
        >
          <Upload size={32} className="text-muted" />
          <div className="text-center">
            <p className="text-sm font-medium text-ink">Drag & drop your resume here</p>
            <p className="mt-1 text-xs text-muted">or click to browse files</p>
          </div>
        </div>
      )}

      {/* Uploading state */}
      {uploadState === 'uploading' && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-white/5 px-6 py-10">
          <Loader size={32} className="animate-spin text-accent" />
          <p className="text-sm text-muted">Parsing {file?.name}…</p>
        </div>
      )}

      {/* Done state */}
      {uploadState === 'done' && (
        <div className="flex items-start gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
          <CheckCircle size={22} className="mt-0.5 shrink-0 text-emerald-400" />
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-300">Resume uploaded &amp; parsed!</p>
            <p className="mt-0.5 text-xs text-emerald-400/70">
              Skills, job titles, and profile fields have been pre-filled. Your resume is saved to your profile.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {displayName && (
                <div className="flex items-center gap-1.5">
                  <FileText size={13} className="text-emerald-400/70" />
                  <span className="text-xs text-muted">{displayName}</span>
                </div>
              )}
              {storedResumeUrl && (
                <a
                  href={storedResumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-accent underline underline-offset-2 hover:text-accent/80"
                >
                  <ExternalLink size={12} />
                  View resume
                </a>
              )}
            </div>
          </div>
          <button type="button" onClick={reset} className="shrink-0 text-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Error state */}
      {uploadState === 'error' && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300">{errorMsg || 'Something went wrong.'}</p>
            </div>
            <button type="button" onClick={reset} className="shrink-0 text-muted hover:text-ink">
              <X size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 text-xs text-accent underline underline-offset-2"
          >
            Try a different file
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        className="hidden"
        onChange={handleFileInput}
      />

      <p className="text-center text-xs text-muted">
        Your resume is stored in your profile and can be updated anytime in settings.
      </p>
    </div>
  );
}
