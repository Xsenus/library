'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { okvedMainSchema, type OkvedCompany } from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowUpRight, X } from 'lucide-react';

type OkvedMain = ReturnType<typeof okvedMainSchema.parse>;

export default function OkvedTab() {
  const sp = useSearchParams();
  const router = useRouter();
  // пустая строка = «все компании»
  const initialOkved = (sp.get('okved') ?? '').trim();

  const [okveds, setOkveds] = useState<OkvedMain[]>([]);
  const [okved, setOkved] = useState<string>(initialOkved);
  const [companies, setCompanies] = useState<OkvedCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetch('/api/okved/main', { cache: 'no-store' });
      const data = await res.json();
      if (!mounted) return;
      setOkveds(data.items ?? []);
      // по умолчанию — не выбирать фильтр (показываем все)
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // загрузка компаний (включая «все», если okved === '')
  useEffect(() => {
    setLoading(true);
    const url = new URL('/api/okved/companies', window.location.origin);
    if (okved) url.searchParams.set('okved', okved);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));

    fetch(url.toString(), { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .finally(() => setLoading(false));

    // синхронизация URL: /library?tab=okved[&okved=...]
    const qs = new URLSearchParams(Array.from(sp.entries()));
    qs.set('tab', 'okved');
    if (okved) qs.set('okved', okved);
    else qs.delete('okved');
    router.replace(`/library?${qs.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okved, page]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  function revenueMln(x: number | null | undefined) {
    if (!x || !Number.isFinite(x)) return '—';
    return Math.round(x / 1_000_000).toLocaleString('ru-RU');
  }

  const isAll = okved === '';

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {/* Левый фильтр ОКВЭД */}
      <Card className="lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ОКВЭД</CardTitle>
          {!isAll && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOkved('');
                setPage(1);
              }}
              title="Сбросить фильтр">
              <X className="h-4 w-4 mr-1" /> Сбросить
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="Поиск по коду/названию…"
            onChange={(e) => {
              const q = e.target.value.toLowerCase();
              const elts = document.querySelectorAll('[data-okved-row]');
              elts.forEach((el) => {
                const text = (el.getAttribute('data-q') ?? '').toLowerCase();
                (el as HTMLElement).style.display = text.includes(q) ? '' : 'none';
              });
            }}
          />

          <div className="max-h-[60vh] overflow-auto divide-y">
            {/* Псевдо-строка «Все компании» */}
            <div
              data-okved-row
              data-q="все компании"
              className={`flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer ${
                isAll ? 'bg-muted' : 'hover:bg-muted'
              }`}
              onClick={() => {
                setOkved('');
                setPage(1);
              }}
              title="Показать все компании">
              <Button
                size="icon"
                variant="secondary"
                className="shrink-0"
                title="Открыть все компании в новой вкладке"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(`/library?tab=okved`, '_blank');
                }}>
                <ArrowUpRight className="h-4 w-4" />
              </Button>
              <div className="truncate">
                <div className="font-medium">Все компании</div>
                <div className="text-xs text-muted-foreground truncate">без фильтра</div>
              </div>
            </div>

            {okveds.map((x) => {
              const active = okved === x.okved_code;
              return (
                <div
                  key={x.id}
                  data-okved-row
                  data-q={`${x.okved_code} ${x.okved_main}`}
                  className={`flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer ${
                    active ? 'bg-muted' : 'hover:bg-muted'
                  }`}
                  onClick={() => {
                    // повторный клик по активному — снимает фильтр
                    setPage(1);
                    setOkved(active ? '' : x.okved_code);
                  }}
                  title="Загрузить компании справа">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="shrink-0"
                    title="Открыть в новой вкладке"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = `/library?tab=okved${
                        x.okved_code ? `&okved=${encodeURIComponent(x.okved_code)}` : ''
                      }`;
                      window.open(url, '_blank');
                    }}>
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                  <div className="truncate">
                    <div className="font-medium">{x.okved_code}</div>
                    <div className="text-xs text-muted-foreground truncate">{x.okved_main}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Правая часть — таблица компаний */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>
            {isAll ? 'Все компании' : `Компании по ОКВЭД ${okved}`}
            {total ? ` · ${total.toLocaleString('ru-RU')}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative w-full overflow-auto">
            <table className="w-full text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="text-left">
                  <th className="py-2 pr-2 w-[56px]"></th>
                  <th className="py-2 pr-4">ИНН</th>
                  <th className="py-2 pr-4">Название</th>
                  <th className="py-2 pr-4">Выручка, млн</th>
                  <th className="py-2 pr-4">Адрес</th>
                  <th className="py-2 pr-4">Филиалов</th>
                  <th className="py-2 pr-2">Год</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}
                {!loading && companies.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      Нет данных
                    </td>
                  </tr>
                )}
                {!loading &&
                  companies.map((c) => (
                    <tr key={`${c.inn}-${c.year}`} className="border-b hover:bg-muted/40">
                      <td className="py-1 pr-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Открыть карточку компании"
                          onClick={() =>
                            window.open(`/company?inn=${encodeURIComponent(c.inn)}`, '_blank')
                          }>
                          <ArrowUpRight className="h-4 w-4" />
                        </Button>
                      </td>
                      <td className="py-1 pr-4 whitespace-nowrap">{c.inn}</td>
                      <td className="py-1 pr-4">{c.short_name}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{revenueMln(c.revenue)}</td>
                      <td className="py-1 pr-4">{c.address ?? '—'}</td>
                      <td className="py-1 pr-4">{c.branch_count ?? '—'}</td>
                      <td className="py-1 pr-2">{c.year ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-3">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Назад
              </Button>
              <div className="text-xs text-muted-foreground">
                страница {page} / {pages}
              </div>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                Вперёд
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
