'use client';

import * as React from 'react';
import { AreaChart, Area, XAxis, YAxis } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';

type Props = {
  /** 4 точки слева→направо: revenue-3, revenue-2, revenue-1, revenue */
  revenue: [
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
  ];
  /** Год отчётности ряда (для окраски) */
  year?: number | null;
  /** Актуальный год (по умолчанию = текущий − 1) */
  actualYear?: number;
  /** Габариты (по умолчанию 100×45) */
  width?: number;
  height?: number;
  className?: string;
};

const M = { left: 0, right: 0, top: 2, bottom: 2 };
const v0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

export default function InlineRevenueStep({
  revenue,
  year,
  actualYear = new Date().getFullYear() - 1,
  width = 100,
  height = 45,
  className,
}: Props) {
  // — хук всегда вызывается без условий
  const gid = React.useId();
  const gRev = `g-rev-${gid}`;

  // если нет ни одного числа — ничего не рисуем
  const hasData = revenue.some(isNum);
  if (!hasData) return null;

  // реальные 4 значения для Y-домена
  const r0 = v0(revenue[0]);
  const r1 = v0(revenue[1]);
  const r2 = v0(revenue[2]);
  const r3 = v0(revenue[3]);

  // фантомные точки для видимых «полок» слева и справа
  // stepAfter рисует горизонталь ПОСЛЕ точки
  const data = [
    { x: -4, r: r0 }, // фантом слева
    { x: -3, r: r0 },
    { x: -2, r: r1 },
    { x: -1, r: r2 },
    { x: 0, r: r3 },
    { x: 1, r: r3 }, // фантом справа
  ];

  // домен Y считаем ТОЛЬКО по реальным 4 точкам
  let yMin = Math.min(r0, r1, r2, r3);
  let yMax = Math.max(r0, r1, r2, r3);
  if (yMin === yMax) {
    if (yMin === 0) {
      yMin = -1;
      yMax = 1;
    } else {
      const pad = Math.abs(yMin) * 0.1 || 1;
      yMin -= pad;
      yMax += pad;
    }
  }

  // положение жирной оси X (y=0) с учётом margin
  const plotH = height - M.top - M.bottom;
  const t = (0 - yMin) / (yMax - yMin);
  const axisInside = (1 - t) * plotH;
  const axisTop = Math.max(0, Math.min(plotH, axisInside)) + M.top;

  // цвет по актуальности года
  const isActual = typeof year === 'number' && year === actualYear;
  const COLOR_REVENUE = isActual ? 'oklch(0.47 0.2 256.22)' : 'oklch(0.79 0 0)';

  return (
    <div className={className} style={{ width, height }}>
      <div className="relative h-full w-full pointer-events-none select-none">
        <ChartContainer
          config={{ r: { label: 'Revenue', color: COLOR_REVENUE } }}
          className="absolute inset-0">
          <AreaChart data={data} margin={M}>
            <defs>
              <linearGradient id={gRev} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_REVENUE} stopOpacity={0.35} />
                <stop offset="95%" stopColor={COLOR_REVENUE} stopOpacity={0.06} />
              </linearGradient>
            </defs>

            {/* domain по X охватывает фантомы, ось скрыта */}
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} hide />
            <YAxis hide domain={[yMin, yMax]} />

            <Area
              dataKey="r"
              type="stepAfter"
              stroke={COLOR_REVENUE}
              fill={`url(#${gRev})`}
              strokeWidth={1}
              strokeLinejoin="round"
              strokeLinecap="round"
              isAnimationActive={false}
              connectNulls
              dot={false}
            />
          </AreaChart>
        </ChartContainer>

        {/* жирная ось X */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: Math.round(axisTop),
            height: 2,
            background: 'currentColor',
            opacity: 0.5,
          }}
        />
      </div>
    </div>
  );
}
