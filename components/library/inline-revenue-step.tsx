'use client';

import * as React from 'react';
import { AreaChart, Area, XAxis, YAxis, ReferenceLine } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';

type Props = {
  revenue: [
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
  showGuides?: boolean; 
};

const M = { left: 0, right: 0, top: 2, bottom: 2 };
const v0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const EPS = 0.02;

export default function InlineRevenueStep({
  revenue,
  year,
  actualYear = new Date().getFullYear() - 1,
  width = 100,
  height = 45,
  className,
  showGuides = false,
}: Props) {
  const gid = React.useId();
  const gRev = `g-rev-${gid}`;

  const hasData = revenue.some(isNum);
  if (!hasData) return null;

  const r0 = v0(revenue[0]);
  const r1 = v0(revenue[1]);
  const r2 = v0(revenue[2]);
  const r3 = v0(revenue[3]);

  const data = [
    { x: -EPS, r: r0 },
    { x: 0, r: r0 },
    { x: 1, r: r0 },
    { x: 1, r: r1 },
    { x: 2, r: r1 },
    { x: 2, r: r2 },
    { x: 3, r: r2 },
    { x: 3, r: r3 },
    { x: 4, r: r3 },
    { x: 4 + EPS, r: r3 },
  ];

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

            <XAxis dataKey="x" type="number" domain={[-EPS, 4 + EPS]} allowDataOverflow hide />
            <YAxis hide domain={[yMin, yMax]} />

            {showGuides &&
              [1, 2, 3].map((x) => (
                <line
                  key={x}
                  x1={`${(x / 4) * 100}%`}
                  x2={`${(x / 4) * 100}%`}
                  y1="0"
                  y2="100%"
                  stroke="currentColor"
                  strokeOpacity={0.08}
                />
              ))}

            <ReferenceLine
              y={0}
              stroke="currentColor"
              strokeOpacity={0.6}
              strokeWidth={2}
              ifOverflow="extendDomain"
            />

            <Area
              dataKey="r"
              type="linear"
              stroke={COLOR_REVENUE}
              fill={`url(#${gRev})`}
              strokeWidth={2}
              strokeLinejoin="miter"
              strokeLinecap="butt"
              isAnimationActive={false}
              connectNulls
              dot={{ r: 2, stroke: COLOR_REVENUE, strokeWidth: 1, fill: COLOR_REVENUE }}
              activeDot={false as any}
              baseValue={0}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
