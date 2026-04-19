'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body: Record<string, string> = { email, password };
      if (mode === 'register' && adminToken) body.adminToken = adminToken;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // Store JWT in localStorage and redirect
      localStorage.setItem('koda_token', data.token!);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo size={40} />
          <h1 className="text-[22px] font-semibold text-fg">Koda</h1>
          <p className="text-[13px] text-fg-subtle">Your local AI coding assistant</p>
        </div>

        <div className="koda-glass rounded-2xl p-6">
          {/* Mode tabs */}
          <div className="mb-5 flex rounded-lg bg-bg-subtle p-0.5">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                className={[
                  'flex-1 rounded-md py-1.5 text-[12px] font-medium capitalize transition',
                  mode === m ? 'bg-bg text-fg shadow-sm' : 'text-fg-subtle hover:text-fg',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-fg-subtle">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-fg-subtle">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
                placeholder="••••••••"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-fg-subtle">
                  Admin token <span className="text-fg-subtle/60">(required for 2nd+ user)</span>
                </label>
                <input
                  type="password"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
                  placeholder="AUTH_TOKEN from .env"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px] text-fg-subtle">
            First user becomes admin automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
