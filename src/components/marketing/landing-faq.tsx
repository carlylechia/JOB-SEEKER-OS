const faqs = [
  {
    q: 'What makes Job Seeker OS different from a spreadsheet or generic tracker?',
    a: 'It combines prioritization, workflow management, recruiter tracking, and preparation into one system instead of leaving those steps scattered across tools.',
  },
  {
    q: 'Is this just for software engineers?',
    a: 'No, the operating-system style workflow can be adapted for many job seekers.',
  },
  {
    q: 'Does the app already personalize job rankings?',
    a: 'Yes. The scoring system can take user preferences into account, such as target seniority, region, role focus, remote preferences, and stack priorities.',
  },
  {
    q: 'What is coming next?',
    a: 'The next product direction includes onboarding polish, stronger ingestion from job links and descriptions, and AI-assisted fit explanations.',
  },
];

export function LandingFaq() {
  return (
    <section className="py-24" id="faq">
      <div className="max-w-3xl">
        <span className="badge bg-white/5 text-sky-200">FAQ</span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Built to make the search more strategic, not just more organized.
        </h2>
      </div>

      <div className="mt-10 grid gap-4">
        {faqs.map((item) => (
          <article key={item.q} className="card-pad">
            <h3 className="text-lg font-semibold text-ink">{item.q}</h3>
            <p className="mt-3 text-sm leading-7 text-muted">{item.a}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
