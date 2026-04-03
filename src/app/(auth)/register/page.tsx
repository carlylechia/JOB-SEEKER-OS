'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Logo } from '@/components/shared/logo';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Unable to create your account.');
      setIsSubmitting(false);
      return;
    }

    await signIn('credentials', { email, password, redirect: false });
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="shell flex min-h-screen items-center justify-center py-12">
      <div className="card-pad w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo centered /></div>
        <h1 className="text-2xl font-semibold">Create your workspace</h1>
        <p className="muted mt-1">We’ll create a seeded starter workspace so you can explore the product immediately.</p>
        <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
          <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          {error ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          <button className="btn-primary w-full" disabled={isSubmitting} type="submit">{isSubmitting ? 'Creating account...' : 'Create account'}</button>
        </form>
        <p className="mt-4 text-sm text-muted">Already have an account? <Link href="/login" className="text-accent">Sign in</Link></p>
      </div>
    </div>
  );
}
