'use client';

import { Globe, Github, Linkedin, Sparkles } from 'lucide-react';

type Props = {
  headline: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  onHeadlineChange: (v: string) => void;
  onLinkedinUrlChange: (v: string) => void;
  onGithubUrlChange: (v: string) => void;
  onPortfolioUrlChange: (v: string) => void;
};

export function StepProfileInfo({
  headline,
  linkedinUrl,
  githubUrl,
  portfolioUrl,
  onHeadlineChange,
  onLinkedinUrlChange,
  onGithubUrlChange,
  onPortfolioUrlChange,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Your professional profile</h2>
        <p className="mt-1 text-sm text-muted">
          Add your headline and links — these are used in templates, prep packs, and to personalise your workspace.
          {headline && (
            <span className="ml-1 inline-flex items-center gap-1 text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              Autofilled from your resume
            </span>
          )}
        </p>
      </div>

      <div className="space-y-4">
        {/* Headline */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Professional headline
          </label>
          <input
            className="input"
            placeholder="e.g. Full-Stack Software Engineer"
            value={headline}
            onChange={(e) => onHeadlineChange(e.target.value)}
            maxLength={160}
          />
          <p className="mt-1 text-xs text-muted">A short one-liner that describes you professionally.</p>
        </div>

        {/* LinkedIn */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            LinkedIn URL
          </label>
          <div className="relative">
            <Linkedin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              placeholder="https://linkedin.com/in/your-handle"
              value={linkedinUrl}
              onChange={(e) => onLinkedinUrlChange(e.target.value)}
              type="url"
            />
          </div>
        </div>

        {/* GitHub */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            GitHub URL
          </label>
          <div className="relative">
            <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              placeholder="https://github.com/your-handle"
              value={githubUrl}
              onChange={(e) => onGithubUrlChange(e.target.value)}
              type="url"
            />
          </div>
        </div>

        {/* Portfolio */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Portfolio / website URL
          </label>
          <div className="relative">
            <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="input pl-9"
              placeholder="https://your-portfolio.example.com"
              value={portfolioUrl}
              onChange={(e) => onPortfolioUrlChange(e.target.value)}
              type="url"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
