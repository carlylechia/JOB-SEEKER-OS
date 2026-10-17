import Image from 'next/image';

const chips = [
  'Profile-aware scoring',
  'Recruiter CRM',
  'Interview prep',
  'Priority queue',
];

export function HeroProductPreview() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -left-8 top-12 h-28 w-28 rounded-full bg-accent/[0.12] blur-3xl" />
      <div className="pointer-events-none absolute -right-8 bottom-12 h-32 w-32 rounded-full bg-line-strong/40 blur-3xl" />

      <div className="relative rounded-[2rem] border border-line bg-surface/90 p-3 shadow-soft">
        <div className="rounded-[1.5rem] border border-line bg-surface-sunken p-3">
          <div className="mb-3 flex items-center justify-between rounded-2xl border border-line bg-surface-sunken px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">Live product preview</p>
              <h3 className="mt-1 text-lg font-semibold text-ink">Your entire search in one operating system</h3>
            </div>
            <div className="hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-text sm:block">
              Server-first, user-personalized
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[1.25rem] border border-line bg-card">
            <Image
              src="/marketing/hero-dashboard.png"
              alt="teChia Jobs dashboard preview showing best-fit roles, weekly rhythm, and a ranked queue"
              width={1600}
              height={1000}
              priority
              sizes="(min-width: 1280px) 46vw, (min-width: 1024px) 50vw, 100vw"
              className="h-auto w-full"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {chips.map((chip, index) => (
              <span
                key={chip}
                className={`inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-2 ${
                  index === 0 ? 'float-soft' : index === 1 ? 'float-soft-delayed' : ''
                }`}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
