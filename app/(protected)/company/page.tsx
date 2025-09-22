'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type YearRow = { year: number | null; revenue: number | null; branch_count: number | null };
const revenueMln = (x: number | null | undefined) =>
  !x || !Number.isFinite(x) ? '—' : Math.round(x / 1_000_000).toLocaleString('ru-RU');

export default function CompanyPage() {
  const sp = useSearchParams();
  const inn = sp.get('inn') ?? '';
  const [data, setData] = useState<{ company: any; years: YearRow[] } | null>(null);

  useEffect(() => {
    if (!inn) return;
    fetch(`/api/okved/company?inn=${encodeURIComponent(inn)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d));
  }, [inn]);

  if (!inn) return <div className="p-4 text-sm text-muted-foreground">Не указан ИНН</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Загрузка…</div>;

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {data.company?.short_name ?? 'Компания'} · ИНН {inn}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-3">{data.company?.address ?? '—'}</div>
          <div className="relative w-full overflow-auto">
            <table className="w-full text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="text-left">
                  <th className="py-2 pr-4">Год</th>
                  <th className="py-2 pr-4">Выручка, млн</th>
                  <th className="py-2 pr-4">Филиалов</th>
                </tr>
              </thead>
              <tbody>
                {data.years.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-muted/40">
                    <td className="py-1 pr-4">{r.year ?? '—'}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{revenueMln(r.revenue)}</td>
                    <td className="py-1 pr-4">{r.branch_count ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
