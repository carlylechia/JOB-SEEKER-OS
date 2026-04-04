import Image from 'next/image';
import { ArrowUpRight, BriefcaseBusiness, ChartColumnIncreasing, Sparkles, Users } from 'lucide-react';

const cards = [
  {
    title: 'Job workspace',
    text: 'Turn a raw opportunity into a focused action plan with context, fit, follow-up timing, and next steps in one place.',
    image: '/marketing/workspace-preview.png',
    alt: 'Job Seeker OS workspace preview showing role details, fit score, and checklist status',
    eyebrow: 'Operate from context',
    wide: true,
  },
  {
    title: 'Priority queue',
    text: 'Know what deserves effort today and why, instead of guessing where to spend your energy.',
    image: '/marketing/queue-preview.png',
    alt: 'Queue preview showing ranked best-fit jobs with priorities and statuses',
    eyebrow: 'Decide faster',
  },
  {
    title: 'Profile-aware scoring',
    text: 'Rank opportunities against level, region, time overlap, salary expectations, and target stack.',
    icon: Sparkles,
    eyebrow: 'Personalized by default',
  },
  {
    title: 'Recruiter and outreach clarity',
    text: 'Keep relationships, follow-ups, and interview preparation connected to each opportunity.',
    icon: Users,
    eyebrow: 'Stay coordinated',
  },
  {
    title: 'Actionable search dashboard',
    text: 'Track momentum, follow-ups, interviews, and readiness without bouncing between spreadsheets and notes.',
    icon: ChartColumnIncreasing,
    eyebrow: 'See what matters',
  },
  {
    title: 'Built for serious applicants',
    text: 'Job Seeker OS is designed for people who want disciplined progress, clearer decisions, and less application chaos.',
    icon: BriefcaseBusiness,
    eyebrow: 'From messy search to system',
  },
];

export function FeatureBentoGrid() {
  return (
    <section className="py-24" id="features">
      <div className="max-w-3xl">
        <span className="badge bg-white/5 text-sky-200">Why it feels different</span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          More than a tracker. This is a job-search operating system.
        </h2>
        <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
          Most job tools stop at storing links and statuses. Job Seeker OS helps users decide what to apply to, why it fits,
          and what to do next.
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.title}
              className={`card-pad overflow-hidden ${card.wide ? 'lg:col-span-2' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">{card.eyebrow}</p>
                  <h3 className="mt-3 text-xl font-semibold text-ink">{card.title}</h3>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">{card.text}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300">
                  {Icon ? <Icon className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
              </div>

              {card.image ? (
                <div className="relative mt-6 overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#09111f]">
                  <Image
                    src={card.image}
                    alt={card.alt ?? ''}
                    width={1600}
                    height={1000}
                    loading="lazy"
                    sizes={card.wide ? '(min-width: 1024px) 60vw, 100vw' : '(min-width: 1024px) 30vw, 100vw'}
                    className="h-auto w-full"
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
