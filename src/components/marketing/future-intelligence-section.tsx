export function FutureIntelligenceSection() {
  return (
    <section className="py-24" id="future">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card-pad lg:col-span-2">
          <span className="badge bg-accent/15 text-sky-200">Where the product is headed</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            The long-term direction is job-search intelligence, not just task tracking.
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted sm:text-lg">
            The current product already gives structure. Future releases will add ingestion, clearer fit explanations, and
            eventually a daily shortlist of the strongest roles to apply to.
          </p>
        </div>
        <div className="card-pad">
          <div className="space-y-3 text-sm text-muted">
            <p>Upcoming capabilities include:</p>
            <ul className="space-y-2">
              <li>• job-link and description ingestion</li>
              <li>• AI-assisted fit explanations</li>
              <li>• demo workspace and onboarding polish</li>
              <li>• smart daily best-fit recommendations</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
