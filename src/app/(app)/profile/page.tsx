export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="title">Profile</h1>
        <p className="muted mt-1">Personal links and candidate profile.</p>
      </div>
      <div className="card-pad grid gap-4 md:grid-cols-2">
        <div><label className="mb-2 block text-sm text-muted">Full name</label><input className="input" defaultValue="Chia Carlyle" /></div>
        <div><label className="mb-2 block text-sm text-muted">Headline</label><input className="input" defaultValue="Full-Stack Software Engineer" /></div>
        <div><label className="mb-2 block text-sm text-muted">Portfolio URL</label><input className="input" defaultValue="https://your-portfolio.example.com" /></div>
        <div><label className="mb-2 block text-sm text-muted">GitHub URL</label><input className="input" defaultValue="https://github.com/your-handle" /></div>
        <div><label className="mb-2 block text-sm text-muted">LinkedIn URL</label><input className="input" defaultValue="https://linkedin.com/in/your-handle" /></div>
        <div><label className="mb-2 block text-sm text-muted">Resume URL</label><input className="input" defaultValue="https://your-site.com/resume.pdf" /></div>
      </div>
    </div>
  );
}
