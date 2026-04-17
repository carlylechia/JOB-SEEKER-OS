'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const STEPS = [
  { label: 'Basics', icon: '👤' },
  { label: 'Photo', icon: '📸' },
  { label: 'Location', icon: '📍' },
  { label: 'Resume', icon: '📄' },
  { label: 'Profile', icon: '🔗' },
  { label: 'Preferences', icon: '🎯' },
];

type Props = {
  currentStep: number; // 1-based
};

export function OnboardingProgressBar({ currentStep }: Props) {
  return (
    <div className="w-full">
      {/* Step indicators */}
      <div className="relative flex items-center justify-between">
        {/* Connecting line */}
        <div className="absolute left-0 right-0 top-4 h-0.5 bg-white/10" />
        <motion.div
          className="absolute left-0 top-4 h-0.5 bg-accent"
          initial={{ width: '0%' }}
          animate={{ width: `${((currentStep - 1) / (STEPS.length - 1)) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
        />

        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const isDone = stepNumber < currentStep;
          const isActive = stepNumber === currentStep;

          return (
            <div key={step.label} className="relative z-10 flex flex-col items-center gap-2">
              <motion.div
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isActive
                    ? 'bg-accent text-white ring-2 ring-accent/30 ring-offset-2 ring-offset-[#08111f]'
                    : 'bg-white/10 text-muted',
                ].join(' ')}
                animate={{ scale: isActive ? 1.1 : 1 }}
                transition={{ duration: 0.2 }}
              >
                {isDone ? <Check size={14} strokeWidth={2.5} /> : <span>{step.icon}</span>}
              </motion.div>
              <span
                className={[
                  'hidden text-xs font-medium sm:block',
                  isActive ? 'text-ink' : isDone ? 'text-emerald-400' : 'text-muted',
                ].join(' ')}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress label */}
      <p className="mt-4 text-center text-xs text-muted">
        Step {currentStep} of {STEPS.length}
      </p>
    </div>
  );
}
