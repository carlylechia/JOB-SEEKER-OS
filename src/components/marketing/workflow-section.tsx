const steps = [
  {
    step: '01',
    title: 'Capture opportunities quickly',
    text: 'Save a job, paste the essentials, and start from a structured record instead of a chaotic link dump.',
  },
  {
    step: '02',
    title: 'Score fit against your profile',
    text: 'Use your preferred level, regions, stack, and salary expectations to rank what is actually worth your attention.',
  },
  {
    step: '03',
    title: 'Work from a detailed job workspace',
    text: 'Bring notes, follow-ups, preparation, and context together so each role becomes actionable.',
  },
  {
    step: '04',
    title: 'Move through the pipeline with clarity',
    text: 'Track recruiters, interviews, templates, and follow-ups from one dashboard instead of juggling tools.',
  },
];

export function WorkflowSection() {
  return (
    <section className="py-24" id="workflow">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div>
          <span className="badge bg-white/5 text-sky-200">A calmer workflow</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Replace scattered applications with one coherent system.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted sm:text-lg">
            The app is designed to reduce decision fatigue. Every part of the workflow supports the same outcome: clearer
            focus, stronger prioritization, and better execution.
          </p>
        </div>

        <div className="grid gap-4">
          {steps.map((item, index) => (
            <div key={item.step} className="card-pad relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-sky-400 to-indigo-500" />
              <div className="pl-4">
                <div className="flex items-center gap-4">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-sky-200">
                    {item.step}
                  </span>
                  <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-7 text-muted">{item.text}</p>
              </div>
              {index < steps.length - 1 ? <div className="mt-4 h-px bg-white/5" /> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
