'use client';

import * as React from 'react';
import { Area, AreaChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

export type MiniStackedAreaProps = {
  /** [r3, r2, r1, r] */
  revenue: (number | null | undefined)[];
  /** [i3, i2, i1, i] */
  income: (number | null | undefined)[];
  year: number | null | undefined;
  width?: number; // default 100
  height?: number; // default 45
  className?: string;
  /** Текст для a11y: будет отрендерен рядом, но вне ChartContainer */
  title?: string;
};

// Палитра под референс (два оттенка синего)
const REV_STROKE = '#3B82F6'; // blue-500
const REV_FILL = '#93C5FD'; // blue-300
const INC_STROKE = '#2563EB'; // blue-600
const INC_FILL = '#BFDBFE'; // blue-200

function norm4(a: (number | null | undefined)[]) {
  const out = (a ?? []).slice(0, 4).map((v) => (Number.isFinite(v as number) ? (v as number) : 0));
  while (out.length < 4) out.unshift(0);
  return out;
}

export const MiniStackedArea = React.memo(function MiniStackedArea({
  revenue,
  income,
  year,
  width = 100,
  height = 45,
  className,
  title,
}: MiniStackedAreaProps) {
  const r = React.useMemo(() => norm4(revenue), [revenue]);
  const i = React.useMemo(() => norm4(income), [income]);

  // точки графика: x = -3,-2,-1,0
  const data = React.useMemo(
    () => [
      { x: -3, r: r[0], i: i[0] },
      { x: -2, r: r[1], i: i[1] },
      { x: -1, r: r[2], i: i[2] },
      { x: 0, r: r[3], i: i[3] },
    ],
    [r, i],
  );

  // 1) сырые min/max по данным
  const [rawMin, rawMax] = React.useMemo(() => {
    const all = [...r, ...i].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    if (!all.length) return [-1, 1];
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (min === max) {
      // защита от плоской линии
      if (min === 0) return [-1, 1];
      const pad = Math.abs(min) * 0.1 || 1;
      min -= pad;
      max += pad;
    }
    return [min, max];
  }, [r, i]);

  // 2) добавляем «дыхание» сверху/снизу, чтобы stroke не «лип»
  const pad = React.useMemo(() => Math.max((rawMax - rawMin) * 0.06, 1), [rawMin, rawMax]);
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  // 3) положение оси X:
  // - если весь ряд >0 → ось у нижней границы (y=rawMin)
  // - если весь ряд <0 → ось у верхней границы (y=rawMax)
  // - иначе → ось на y=0
  // затем клампим в итоговый домен [yMin..yMax]
  const axisY = React.useMemo(() => {
    let y = 0;
    if (rawMin > 0) y = rawMin;
    else if (rawMax < 0) y = rawMax;
    return Math.min(Math.max(y, yMin), yMax);
  }, [rawMin, rawMax, yMin, yMax]);

  // цвета для легенды/vars (если понадобится)
  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      r: { label: 'Выручка', color: REV_STROKE },
      i: { label: 'Прибыль', color: INC_STROKE },
    }),
    [],
  );

  return (
    <div className={className} style={{ width, height }} aria-hidden={!!title ? undefined : true}>
      {/* relative + высокий z-index помогают тултипу быть поверх таблицы */}
      <ChartContainer config={chartConfig} className="h-full w-full relative z-[3]">
        <AreaChart
          data={data}
          // небольшой отступ, чтобы stroke не обрезался
          margin={{ left: 0, right: 0, top: 2, bottom: 2 }}>
          {/* тултип со сверхвысоким z-index */}
          <ChartTooltip
            cursor={false}
            wrapperStyle={{ zIndex: 2147483647, pointerEvents: 'none' }}
            content={<ChartTooltipContent hideLabel />}
          />
          <XAxis dataKey="x" hide />
          {/* домен ровно по данным с паддингом */}
          <YAxis hide domain={[yMin, yMax]} allowDataOverflow />
          {/* жирная ось X, «притягивается» к краям если 0 вне диапазона */}
          <ReferenceLine
            y={axisY}
            stroke="currentColor"
            strokeOpacity={0.8}
            strokeWidth={2}
            ifOverflow="extendDomain"
          />

          {/* income (нижняя) */}
          <Area
            type="natural"
            dataKey="i"
            fill={INC_FILL}
            stroke={INC_STROKE}
            fillOpacity={0.45}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
            dot={false}
            activeDot={{ r: 3 }}
          />

          {/* revenue (верхняя) */}
          <Area
            type="natural"
            dataKey="r"
            fill={REV_FILL}
            stroke={REV_STROKE}
            fillOpacity={0.35}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ChartContainer>

      {/* A11y-дескриптор отдельно */}
      {title ? <span className="sr-only">{title}</span> : null}
    </div>
  );
});

export default MiniStackedArea;
