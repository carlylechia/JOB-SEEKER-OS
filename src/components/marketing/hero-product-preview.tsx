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
      <div className="pointer-events-none absolute -left-8 top-12 h-28 w-28 rounded-full bg-[#D4AF37]/[0.12] blur-3xl" />
      <div className="pointer-events-none absolute -right-8 bottom-12 h-32 w-32 rounded-full bg-[#C9CED6]/40 blur-3xl" />

      <div className="relative rounded-[2rem] border border-line bg-[#EDEFF2]/90 p-3 shadow-soft">
        <div className="rounded-[1.5rem] border border-[#DFE3E9] bg-black/[0.03] p-3">
          <div className="mb-3 flex items-center justify-between rounded-2xl border border-[#DFE3E9] bg-[#F4F5F7] px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D1F]">Live product preview</p>
              <h3 className="mt-1 text-lg font-semibold text-ink">Your entire search in one operating system</h3>
            </div>
            <div className="hidden rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-1 text-xs font-medium text-[#8A6D1F] sm:block">
              Server-first, user-personalized
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[1.25rem] border border-[#DFE3E9] bg-[#FFFFFF]">
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
                className={`inline-flex items-center rounded-full border border-[#DFE3E9] px-3 py-1.5 text-xs font-medium text-[#3A4048] ${
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
