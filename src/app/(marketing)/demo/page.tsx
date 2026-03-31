import Link from 'next/link';

export default function DemoPage() {
  return (
    <div className="shell py-16">
      <div className="card-pad">
        <span className="badge bg-accent/15 text-blue-200">Demo overview</span>
        <h1 className="mt-4 text-4xl font-semibold">What this MVP already does</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {['Dashboard with KPIs and trends', 'Job tracker with fit scoring and priority logic', 'Contacts CRM and interview pipeline', 'Tailored application queue', 'Prep packs and follow-up templates', 'Local demo persistence for quick deployment'].map((item) => (
            <div key={item} className="rounded-xl border border-line p-4">{item}</div>
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          <Link href="/dashboard" className="btn-primary">Open demo app</Link>
          <Link href="/" className="btn-secondary">Back home</Link>
        </div>
      </div>
    </div>
  );
}
