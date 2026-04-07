'use client';

import { useEffect, useState } from 'react';
import { useJobs } from '@/hooks/use-job-data';

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
      <div className="card-pad grid gap-4 md:grid-cols-2">
        <div><label className="mb-2 block text-sm text-muted">Full name</label><input className="input" value={form.fullName} onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))} /></div>
        <div><label className="mb-2 block text-sm text-muted">Headline</label><input className="input" value={form.headline} onChange={(e) => setForm((prev) => ({ ...prev, headline: e.target.value }))} placeholder="Full-Stack Software Engineer" /></div>
        <div><label className="mb-2 block text-sm text-muted">Portfolio URL</label><input className="input" value={form.portfolioUrl} onChange={(e) => setForm((prev) => ({ ...prev, portfolioUrl: e.target.value }))} placeholder="https://your-portfolio.example.com" /></div>
        <div><label className="mb-2 block text-sm text-muted">GitHub URL</label><input className="input" value={form.githubUrl} onChange={(e) => setForm((prev) => ({ ...prev, githubUrl: e.target.value }))} placeholder="https://github.com/your-handle" /></div>
        <div><label className="mb-2 block text-sm text-muted">LinkedIn URL</label><input className="input" value={form.linkedinUrl} onChange={(e) => setForm((prev) => ({ ...prev, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/your-handle" /></div>
        <div><label className="mb-2 block text-sm text-muted">Resume URL</label><input className="input" value={form.resumeUrl} onChange={(e) => setForm((prev) => ({ ...prev, resumeUrl: e.target.value }))} placeholder="https://your-site.com/resume.pdf" /></div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void handleSave()}>Save profile</button>
        {saved ? <span className="text-sm text-emerald-300">Profile saved.</span> : null}
        {error ? <span className="text-sm text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
