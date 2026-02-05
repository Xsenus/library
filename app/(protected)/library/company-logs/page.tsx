import { Suspense } from 'react';
import CompanyLogsPage from '@/components/library/company-logs-page';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Загрузка логов…</div>}>
      <CompanyLogsPage />
    </Suspense>
  );
}
