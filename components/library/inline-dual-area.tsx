'use client';

import * as React from 'react';
import { AreaChart, Area, XAxis, YAxis } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';

type Props = {
  revenue: [
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
  ];
  income: [
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
  ];
  year?: number | null;
  actualYear?: number;
  width?: number;
  height?: number;
  className?: string;
};

const M = { left: 0, right: 0, top: 0, bottom: 2 };
const v0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

export default function InlineDualArea({
  revenue,
  income,
  year,
  actualYear = new Date().getFullYear() - 1,
  width = 100,
  height = 45,
  className,
}: Props) {
  // — хук всегда вызывается (никаких условных вызовов)
  const gid = React.useId();
  const gDesk = `g-desk-${gid}`;
  const gMob = `g-mob-${gid}`;

  // данные «как есть» (null/undefined/NaN -> 0)
  const data = [
    { x: -3, r: v0(revenue[0]), i: v0(income[0]) },
    { x: -2, r: v0(revenue[1]), i: v0(income[1]) },
    { x: -1, r: v0(revenue[2]), i: v0(income[2]) },
    { x: 0, r: v0(revenue[3]), i: v0(income[3]) },
  ];

  // если реально нет ни одного числа — не рендерим вообще
  const hasData = revenue.some(isNum) || income.some(isNum);
  if (!hasData) return null;

  // домен по фактическим числам
  const all = [
    data[0].r,
    data[1].r,
    data[2].r,
    data[3].r,
    data[0].i,
    data[1].i,
    data[2].i,
    data[3].i,
  ];
  let yMin = Math.min(...all);
  let yMax = Math.max(...all);
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

  // ось X (y=0) с учётом margin'ов
  const plotH = height - M.top - M.bottom;
  const t = (0 - yMin) / (yMax - yMin);
  const axisInside = (1 - t) * plotH;
  const axisTop = Math.max(0, Math.min(plotH, axisInside)) + M.top;

  // цвета по актуальности года
  const isActual = typeof year === 'number' && year === actualYear;
  const COLOR_DESKTOP = isActual ? 'oklch(0.47 0.2 256.22)' : 'oklch(0.79 0 0)';
  const COLOR_MOBILE = isActual ? 'oklch(0.33 0.14 255.49)' : 'oklch(0.55 0 0)';

  return (
    <div className={className} style={{ width, height }}>
      <div className="relative h-full w-full pointer-events-none select-none">
        <ChartContainer
          config={{
            r: { label: 'Revenue', color: COLOR_DESKTOP },
            i: { label: 'Income', color: COLOR_MOBILE },
          }}
          className="absolute inset-0">
          <AreaChart data={data} margin={M}>
            <defs>
              <linearGradient id={gMob} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_MOBILE} stopOpacity={0.45} />
                <stop offset="95%" stopColor={COLOR_MOBILE} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id={gDesk} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_DESKTOP} stopOpacity={0.35} />
                <stop offset="95%" stopColor={COLOR_DESKTOP} stopOpacity={0.04} />
              </linearGradient>
            </defs>

            <XAxis dataKey="x" hide />
            <YAxis hide domain={[yMin, yMax]} />

            <Area
              dataKey="i"
              type="monotoneX"
              stroke={COLOR_MOBILE}
              fill={`url(#${gMob})`}
              strokeWidth={1}
              strokeLinejoin="round"
              strokeLinecap="round"
              isAnimationActive={false}
              connectNulls
              dot={false}
            />
            <Area
              dataKey="r"
              type="monotoneX"
              stroke={COLOR_DESKTOP}
              fill={`url(#${gDesk})`}
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
