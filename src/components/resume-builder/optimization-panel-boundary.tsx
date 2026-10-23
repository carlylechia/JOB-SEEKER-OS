'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Keep an optimizer rendering failure inside its panel so editing remains available. */
export class OptimizationPanelBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; resetKey: number }
> {
  state = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError() {
    return { hasError: true, resetKey: 0 };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The application error logger handles server failures. This local boundary
    // keeps malformed historical suggestion data from taking down the editor.
  }

  render() {
    if (this.state.hasError) {
      return (
        <section aria-labelledby="optimization-recovery-heading" className="card-pad space-y-3" role="alert">
          <div>
            <h2 id="optimization-recovery-heading" className="text-base font-semibold text-ink">
              Suggestions are temporarily unavailable
            </h2>
            <p className="mt-1 text-sm text-muted">
              Your resume is safe and you can keep editing. Try loading the suggestions again.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => this.setState((state) => ({ hasError: false, resetKey: state.resetKey + 1 }))}
          >
            Try again
          </button>
        </section>
      );
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
