const pillars = [
  'Target seniority and role family',
  'Preferred regions and timezone overlap',
  'Salary floor and compensation expectations',
  'Remote preference and eligibility rules',
  'Must-have stack and bonus technologies',
  'Workflow readiness before applying',
];

export function PersonalizationSection() {
  return (
    <section className="py-24" id="personalization">
      <div className="card-pad overflow-hidden">
        <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div>
            <span className="badge bg-white/5 text-sky-200">Personalized by design</span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              One product, many job-search strategies — ranked around each user.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              Job Seeker OS is built to score and prioritize opportunities around the person using it, not around a generic
              one-size-fits-all checklist.
            </p>
          </div>

          <div className="grid gap-3">
            {pillars.map((pillar) => (
              <div key={pillar} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-200">
                  •
                </span>
                <span className="text-sm text-ink">{pillar}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
