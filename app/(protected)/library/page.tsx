import { Suspense } from 'react';
import LibraryClient from './LibraryClient';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Загрузка…</div>}>
      <LibraryClient />
    </Suspense>
  );
}
