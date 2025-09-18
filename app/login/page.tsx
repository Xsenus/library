'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function LoginPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const next = sp.get('next') || '/library';

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(true); // «Оставаться в системе 7 дней» + сохранить логин
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Если уже авторизован — сразу на next (/library)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        if (!cancelled && r.ok) {
          router.replace(next);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  useEffect(() => {
    const saved = localStorage.getItem('cin:lastLogin');
    if (saved) setLogin(saved);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!login || !password) {
      setErr('Укажите логин и пароль');
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // важно: чтобы Set-Cookie точно применился
        cache: 'no-store',
        credentials: 'same-origin',
        body: JSON.stringify({ login, password, remember: rememberLogin }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErr(data?.error || 'Ошибка входа');
        setLoading(false);
        return;
      }

      // только логин сохраняем локально
      if (rememberLogin) localStorage.setItem('cin:lastLogin', login);
      else localStorage.removeItem('cin:lastLogin');

      // ⬇️ ключевой момент: делаем полную навигацию, чтобы middleware прочитал cookie
      window.location.replace(next); // вместо router.replace(next)
    } catch {
      setErr('Сеть недоступна');
      setLoading(false);
    }
  }

  const canSubmit = login.trim().length > 0 && password.trim().length > 0 && !loading;

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border p-6 shadow-sm space-y-4">
        <h1 className="text-xl font-semibold">Вход в систему</h1>

        <div className="space-y-2">
          <label className="text-sm">Логин</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            inputMode="email"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm">Пароль</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) onSubmit(e as any);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Если включено «Запомнить меня», сессия сохранится на 7 дней. Браузер может отдельно
            предложить сохранить пароль — это нормально.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rememberLogin}
            onChange={(e) => setRememberLogin(e.target.checked)}
          />
          Запомнить меня (7 дней) и логин на этом устройстве
        </label>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <button
          className="w-full rounded-md bg-black text-white py-2 disabled:opacity-50"
          disabled={!canSubmit}>
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </main>
  );
}
