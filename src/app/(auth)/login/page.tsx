import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="shell flex min-h-screen items-center justify-center py-12">
      <div className="card-pad w-full max-w-md">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="muted mt-1">Auth is stubbed in this first zip. Use the app demo directly.</p>
        <div className="mt-6 space-y-3">
          <input className="input" placeholder="Email" />
          <input className="input" placeholder="Password" type="password" />
          <Link href="/dashboard" className="btn-primary w-full">Continue to app</Link>
        </div>
      </div>
    </div>
  );
}
