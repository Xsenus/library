// app/(protected)/layout.tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const sess = await getSession();
  if (!sess) redirect('/login');

  // Проверяем актуальный статус в БД
  const live = await getLiveUserState(sess.id);
  if (!live || !live.activated) {
    // В layout НЕЛЬЗЯ трогать cookies(), поэтому просто редиректим.
    // Кука очистится при ближайшем запросе к /api/auth/me или любому защищённому API.
    redirect('/login');
  }

  return <>{children}</>;
}
