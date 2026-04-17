'use client';

import { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ChevronLeft, SkipForward, Loader } from 'lucide-react';
import { Logo } from '@/components/shared/logo';

import { OnboardingProgressBar } from './progress-bar';
import { StepBasicInfo } from './step-basic-info';
import { StepProfilePhoto } from './step-profile-photo';
import { StepLocation } from './step-location';
import { StepResume } from './step-resume';
import { StepJobPreferences } from './step-job-preferences';
import { StepProfileInfo } from './step-profile-info';
import type { SeniorityLevel } from '@/types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type RemotePreference = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE';

export type OnboardingInitialData = {
  name: string;
  email: string;
  isLinkedinUser: boolean;
  linkedinPhotoUrl: string;
  currentStep: number;
  profilePictureUrl: string;
  location: string;
  remotePreference: RemotePreference;
  timezones: string[];
  resumeUrl: string;
  jobTitles: string[];
  skills: string[];
  salaryMin: number;
  salaryTarget: number;
  currentLevel: SeniorityLevel;
  targetLevel: SeniorityLevel;
  titleOptions: string[];
  // Extracted profile links
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  headline: string;
};

type FormState = Omit<OnboardingInitialData, 'currentStep'>;

// ─────────────────────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────────────────────

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
    scale: 0.97,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -60 : 60,
    opacity: 0,
    scale: 0.97,
  }),
};

const TOTAL_STEPS = 6;

// ─────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────

async function saveStep(step: number, payload: Record<string, unknown>) {
  const res = await fetch('/api/onboarding/update', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, ...payload }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error ?? 'Failed to save progress.');
  }
}

async function completeOnboarding(payload: Record<string, unknown>) {
  const res = await fetch('/api/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error ?? 'Failed to complete onboarding.');
  }
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function OnboardingShell({ initialData }: { initialData: OnboardingInitialData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(Math.min(Math.max(initialData.currentStep, 1), TOTAL_STEPS));
  const [direction, setDirection] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<FormState>({
    name: initialData.name,
    email: initialData.email,
    isLinkedinUser: initialData.isLinkedinUser,
    linkedinPhotoUrl: initialData.linkedinPhotoUrl,
    profilePictureUrl: initialData.profilePictureUrl,
    location: initialData.location,
    remotePreference: initialData.remotePreference,
    timezones: initialData.timezones,
    resumeUrl: initialData.resumeUrl,
    jobTitles: initialData.jobTitles,
    skills: initialData.skills,
    salaryMin: initialData.salaryMin,
    salaryTarget: initialData.salaryTarget,
    currentLevel: initialData.currentLevel,
    targetLevel: initialData.targetLevel,
    titleOptions: initialData.titleOptions,
    linkedinUrl: initialData.linkedinUrl,
    githubUrl: initialData.githubUrl,
    portfolioUrl: initialData.portfolioUrl,
    headline: initialData.headline,
  });

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // ── Build the payload for the current step ──
  function getStepPayload(s: number): Record<string, unknown> {
    switch (s) {
      case 1:
        return { name: form.name };
      case 2:
        return { profilePictureUrl: form.profilePictureUrl };
      case 3:
        return {
          location: form.location,
          remotePreference: form.remotePreference,
          timezoneMatches: form.timezones,
        };
      case 4:
        return {
          resumeUrl: form.resumeUrl || undefined,
          preferredStack: form.skills,
        };
      case 5:
        return {
          headline: form.headline,
          linkedinUrl: form.linkedinUrl || undefined,
          githubUrl: form.githubUrl || undefined,
          portfolioUrl: form.portfolioUrl || undefined,
        };
      case 6:
        return {
          preferredTitles: form.jobTitles,
          preferredStack: form.skills,
          salaryMin: form.salaryMin,
          salaryTarget: form.salaryTarget,
          currentLevel: form.currentLevel,
          targetLevel: form.targetLevel,
        };
      default:
        return {};
    }
  }

  // ── Navigate forward ──
  async function goNext() {
    setError('');
    setIsSaving(true);
    try {
      await saveStep(step + 1, getStepPayload(step));
      setDirection(1);
      setStep((s) => Math.min(s + 1, TOTAL_STEPS));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Navigate backward ──
  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 1));
  }

  // ── Complete onboarding ──
  async function handleComplete() {
    setError('');
    setIsSaving(true);
    try {
      await completeOnboarding({
        ...getStepPayload(6),
        name: form.name,
        profilePictureUrl: form.profilePictureUrl,
        location: form.location,
        remotePreference: form.remotePreference,
        timezoneMatches: form.timezones,
        resumeUrl: form.resumeUrl,
        headline: form.headline || undefined,
        linkedinUrl: form.linkedinUrl || undefined,
        githubUrl: form.githubUrl || undefined,
        portfolioUrl: form.portfolioUrl || undefined,
      });
      startTransition(() => {
        router.push('/dashboard');
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Skip onboarding entirely ──
  async function handleSkip() {
    setError('');
    setIsSaving(true);
    try {
      // Best-effort save of current progress
      await saveStep(step, getStepPayload(step));
    } catch {
      // Non-critical — proceed anyway
    } finally {
      setIsSaving(false);
    }
    // Mark as skipped (allows dashboard access, dashboard shows resume prompt)
    try {
      await fetch('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Best-effort
    }
    startTransition(() => {
      router.push('/dashboard');
      router.refresh();
    });
  }

  // ── Resume extracted data handler ──
  const handleResumeExtracted = useCallback(
    (data: {
      resumeUrl?: string;
      suggestedJobTitles?: string[];
      suggestedSkills?: string[];
      fullName?: string;
      headline?: string;
      linkedinUrl?: string;
      githubUrl?: string;
      portfolioUrl?: string;
    }) => {
      setForm((prev) => {
        const next = { ...prev };
        if (data.resumeUrl) next.resumeUrl = data.resumeUrl;
        if (data.fullName && !prev.name) next.name = data.fullName;
        if (data.headline && !prev.headline) next.headline = data.headline;
        if (data.linkedinUrl) next.linkedinUrl = data.linkedinUrl;
        if (data.githubUrl) next.githubUrl = data.githubUrl;
        if (data.portfolioUrl) next.portfolioUrl = data.portfolioUrl;
        if (data.suggestedSkills?.length) {
          next.skills = Array.from(new Set([...prev.skills, ...data.suggestedSkills]));
        }
        if (data.suggestedJobTitles?.length) {
          next.jobTitles = Array.from(new Set([...prev.jobTitles, ...data.suggestedJobTitles]));
        }
        return next;
      });
    },
    [],
  );

  const isLoading = isSaving || isPending;

  return (
    <div className="flex min-h-screen flex-col bg-[#08111f]">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between border-b border-white/6 px-6 py-4">
        <div className="flex items-center gap-2">
          <Logo compact href="/" />
        </div>
        <button
          type="button"
          onClick={handleSkip}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          <SkipForward size={13} />
          Skip for now
        </button>
      </header>

      {/* ── Main content ── */}
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-lg">
          {/* Progress bar */}
          <div className="mb-10">
            <OnboardingProgressBar currentStep={step} />
          </div>

          {/* Step content with slide animation */}
          <div className="relative overflow-hidden rounded-3xl border border-white/8 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-sm">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {step === 1 && (
                  <StepBasicInfo
                    name={form.name}
                    email={form.email}
                    isLinkedinUser={form.isLinkedinUser}
                    onNameChange={(v) => updateForm('name', v)}
                  />
                )}
                {step === 2 && (
                  <StepProfilePhoto
                    profilePictureUrl={form.profilePictureUrl}
                    isLinkedinUser={form.isLinkedinUser}
                    linkedinPhotoUrl={form.linkedinPhotoUrl}
                    name={form.name}
                    onUrlChange={(v) => updateForm('profilePictureUrl', v)}
                  />
                )}
                {step === 3 && (
                  <StepLocation
                    location={form.location}
                    remotePreference={form.remotePreference}
                    timezones={form.timezones}
                    onLocationChange={(v) => updateForm('location', v)}
                    onRemoteChange={(v) => updateForm('remotePreference', v)}
                    onTimezonesChange={(v) => updateForm('timezones', v)}
                  />
                )}
                {step === 4 && (
                  <StepResume resumeUrl={form.resumeUrl} onExtracted={handleResumeExtracted} />
                )}
                {step === 5 && (
                  <StepProfileInfo
                    headline={form.headline}
                    linkedinUrl={form.linkedinUrl}
                    githubUrl={form.githubUrl}
                    portfolioUrl={form.portfolioUrl}
                    onHeadlineChange={(v) => updateForm('headline', v)}
                    onLinkedinUrlChange={(v) => updateForm('linkedinUrl', v)}
                    onGithubUrlChange={(v) => updateForm('githubUrl', v)}
                    onPortfolioUrlChange={(v) => updateForm('portfolioUrl', v)}
                  />
                )}
                {step === 6 && (
                  <StepJobPreferences
                    jobTitles={form.jobTitles}
                    skills={form.skills}
                    salaryMin={form.salaryMin}
                    salaryTarget={form.salaryTarget}
                    currentLevel={form.currentLevel}
                    targetLevel={form.targetLevel}
                    titleOptions={form.titleOptions}
                    onJobTitlesChange={(v) => updateForm('jobTitles', v)}
                    onSkillsChange={(v) => updateForm('skills', v)}
                    onSalaryMinChange={(v) => updateForm('salaryMin', v)}
                    onSalaryTargetChange={(v) => updateForm('salaryTarget', v)}
                    onCurrentLevelChange={(v) => updateForm('currentLevel', v)}
                    onTargetLevelChange={(v) => updateForm('targetLevel', v)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Error ── */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            >
              {error}
            </motion.div>
          )}

          {/* ── Footer navigation ── */}
          <div className="mt-6 flex items-center justify-between gap-4">
            {/* Back */}
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || isLoading}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/5 px-4 py-2.5 text-sm font-medium text-ink transition-all hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft size={16} />
              Back
            </button>

            {/* Next / Complete */}
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={() => void goNext()}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-60"
              >
                {isLoading ? <Loader size={15} className="animate-spin" /> : null}
                Continue
                {!isLoading && <ChevronRight size={16} />}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-60"
              >
                {isLoading ? (
                  <Loader size={15} className="animate-spin" />
                ) : (
                  <span>🎉</span>
                )}
                {isLoading ? 'Setting up…' : 'Get started'}
              </button>
            )}
          </div>

          {/* Step counter */}
          <p className="mt-4 text-center text-xs text-muted">
            {step < TOTAL_STEPS
              ? `${TOTAL_STEPS - step} step${TOTAL_STEPS - step === 1 ? '' : 's'} remaining`
              : 'This is the last step — you\'re almost done!'}
          </p>
        </div>
      </main>
    </div>
  );
}
