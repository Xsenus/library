// app/page.tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl font-semibold mb-6">Главная</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/library" className="block rounded-xl border p-5 hover:shadow transition">
          <div className="text-xl font-medium mb-1">Библиотека</div>
          <p className="text-sm text-gray-500">Отрасли → Классы → Цеха → Оборудование</p>
        </Link>

        <Link
          href="/library?tab=cleanscore"
          className="block rounded-xl border p-5 hover:shadow transition">
          <div className="text-xl font-medium mb-1">Лучшие CleanScore (ChatGPT)</div>
          <p className="text-sm text-gray-500">Сводная таблица с фильтром CS ≥ 0.95</p>
        </Link>
      </div>
    </main>
  );
}
