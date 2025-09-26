'use client';

import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, ReferenceLine } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';

type Props = {
  /** 4 точки слева→направо: revenue-3, revenue-2, revenue-1, revenue */
  revenue: [
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
  ];
  year?: number | null;
  actualYear?: number; // по умолчанию = текущий - 1
  width?: number; // default 100
  height?: number; // default 45
  className?: string;
  /** Показать тонкие направляющие между столбцами (по центрам) */
  showGuides?: boolean;
  /** радиус скругления сверху; 0 = квадраты */
  radius?: number; // default 3
  /** вкл/выкл анимацию */
  animate?: boolean; // default true
  /** длительность анимации (мс) */
  animationDuration?: number; // default 420
};

const M = { left: 0, right: 0, top: 2, bottom: 2 };
const v0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

export default function InlineRevenueBars({
  revenue,
  year,
  actualYear = new Date().getFullYear() - 1,
  width = 100,
  height = 45,
  className,
  showGuides = false,
  radius = 3,
  animate = true,
  animationDuration = 420,
}: Props) {
  const gid = React.useId();
  const gRev = `g-rev-${gid}`;

  const hasData = revenue.some(isNum);
  if (!hasData) return null;

  // 4 значения и 4 категории "0".."3", чтобы нет срезов по краям
  const r = [v0(revenue[0]), v0(revenue[1]), v0(revenue[2]), v0(revenue[3])];
  const data = r.map((val, i) => ({ i: String(i), r: val }));

  const min = Math.min(...r);
  const max = Math.max(...r);

  // домен Y — «полные» столбцы
  let yMin: number;
  let yMax: number;
  if (min >= 0) {
    yMin = 0;
    yMax = max === 0 ? 1 : max * 1.05;
  } else if (max <= 0) {
    yMin = min * 1.05;
    yMax = 0;
  } else {
    const pad = (max - min) * 0.05 || 1;
    yMin = min - pad;
    yMax = max + pad;
  }

  const isActual = typeof year === 'number' && year === actualYear;
  const COLOR = isActual ? 'oklch(0.47 0.2 256.22)' : 'oklch(0.79 0 0)';

  // плотнее компоновка: почти без зазоров, явный barSize под текущую ширину
  const barCategoryGap = 6;
  const barGap = 0;
  const barSize = Math.max(4, Math.floor((width - M.left - M.right - barCategoryGap * 3) / 4));

  return (
    <div className={className} style={{ width, height }}>
      <div className="relative h-full w-full pointer-events-none select-none">
        {showGuides &&
          [1, 2, 3].map((x) => (
            <div
              key={x}
              className="absolute top-0 bottom-0"
              style={{
                left: `${(x / 4) * 100}%`,
                width: 1,
                backgroundColor: 'currentColor',
                opacity: 0.08,
              }}
            />
          ))}

        <ChartContainer
          config={{ r: { label: 'Revenue', color: COLOR } }}
          className="absolute inset-0">
          <BarChart data={data} margin={M} barCategoryGap={barCategoryGap} barGap={barGap}>
            <defs>
              <linearGradient id={gRev} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR} stopOpacity={0.35} />
                <stop offset="95%" stopColor={COLOR} stopOpacity={0.20} />
              </linearGradient>
            </defs>

            {/* категориальная ось: 4 категории, ось скрыта */}
            <XAxis dataKey="i" type="category" interval={0} hide />
            <YAxis hide domain={[yMin, yMax]} />

            <ReferenceLine
              y={0}
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeWidth={2}
              ifOverflow="extendDomain"
            />

            <Bar
              dataKey="r"
              fill={`url(#${gRev})`}
              stroke={COLOR}
              strokeWidth={0}
              radius={[radius, radius, 0, 0]}
              isAnimationActive={animate}
              animationDuration={animationDuration}
              animationEasing="ease-out"
              barSize={barSize}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}
