export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="title">Settings</h1>
        <p className="muted mt-1">Profile preferences, target roles, and future scoring customization.</p>
      </div>
      <div className="card-pad grid gap-4 md:grid-cols-2">
        <div><label className="mb-2 block text-sm text-muted">Target roles</label><input className="input" defaultValue="Full-Stack Engineer, Backend Engineer" /></div>
        <div><label className="mb-2 block text-sm text-muted">Preferred regions</label><input className="input" defaultValue="Worldwide, Africa, Europe" /></div>
        <div><label className="mb-2 block text-sm text-muted">Preferred stack</label><input className="input" defaultValue="TypeScript, Next.js, Node.js, PostgreSQL" /></div>
        <div><label className="mb-2 block text-sm text-muted">Salary target (monthly USD)</label><input className="input" defaultValue="3000 - 4500" /></div>
      </div>
    </div>
  );
}
