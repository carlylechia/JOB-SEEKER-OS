'use client';

import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';

/** Keep an unexpected resume-editor client error inside the resume route. */
export default function ResumeDetailsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto max-w-2xl card-pad space-y-4">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-warn/10 p-2 text-warn-text">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-ink">This resume could not finish loading</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Your saved resume is safe. Retry the editor, or return to your resumes and open it again.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          <RotateCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <Link href="/resumes" className="btn-secondary">Back to resumes</Link>
      </div>
    </section>
  );
}
