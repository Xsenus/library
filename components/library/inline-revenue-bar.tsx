'use client';

import * as React from 'react';

type Series4 = [
  number | null | undefined,
  number | null | undefined,
  number | null | undefined,
  number | null | undefined,
];

type Props = {
  revenue: Series4;
  income?: Series4;
  mode?: 'group' | 'single' | 'stack';
  singleSeries?: 'income' | 'revenue';
  year?: number | null;
  actualYear?: number;
  width?: number;
  height?: number;
  className?: string;
  showGuides?: boolean;
  radius?: number;
  animate?: boolean;
  animationDuration?: number;
  zeroStrokeWidth?: number;
  zeroStrokeOpacity?: number;
};

const safeValue = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

const isValidNumber = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x);

export default function InlineRevenueBars({
  revenue,
  income,
  mode = 'group',
  singleSeries = 'income',
  year,
  actualYear = new Date().getFullYear() - 1,
  width = 100,
  height = 45,
  className = '',
  showGuides = false,
  radius = 3,
  animate = true,
  animationDuration = 600,
  zeroStrokeWidth = 1,
  zeroStrokeOpacity = 0.2,
}: Props) {
  const id = React.useId();

  // Process data
  const revenueData = revenue.map(safeValue);
  const incomeData = income ? income.map(safeValue) : [0, 0, 0, 0];

  const hasRevenue = revenue.some(isValidNumber);
  const hasIncome = income ? income.some(isValidNumber) : false;

  if (!hasRevenue && !hasIncome) return null;

  // Calculate domain
  let allValues: number[] = [];

  if (mode === 'single') {
    allValues = singleSeries === 'revenue' ? revenueData : incomeData;
  } else if (mode === 'stack') {
    allValues = revenueData.map((r, i) => r + incomeData[i]);
  } else {
    allValues = [...revenueData, ...incomeData];
  }

  const minValue = Math.min(...allValues, 0);
  const maxValue = Math.max(...allValues, 0);

  let yMin: number, yMax: number;

  if (minValue >= 0) {
    yMin = 0;
    yMax = maxValue * 1.1 || 1;
  } else if (maxValue <= 0) {
    yMin = minValue * 1.1;
    yMax = 0;
  } else {
    const absMax = Math.max(Math.abs(minValue), Math.abs(maxValue));
    const padding = absMax * 0.1;
    yMin = -(absMax + padding);
    yMax = absMax + padding;
  }

  const range = yMax - yMin;
  const zeroY = height - ((0 - yMin) / range) * height;

  // Layout calculations
  const padding = { left: 2, right: 2, top: 4, bottom: 4 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const barCount = 4;
  const groupGap = Math.max(1, chartWidth * 0.02);
  const availableWidth = chartWidth - groupGap * (barCount - 1);
  const groupWidth = availableWidth / barCount;

  let barWidth: number;
  let barSpacing = 0;

  if (mode === 'group' && hasRevenue && hasIncome) {
    barSpacing = Math.max(1, groupWidth * 0.1);
    barWidth = (groupWidth - barSpacing) / 2;
  } else {
    barWidth = groupWidth * 0.8;
  }

  // Color scheme
  const isActual = typeof year === 'number' && year === actualYear;

  const colors = isActual
    ? {
        revenue: {
          positive: '#60A5FA',
          negative: '#2563EB',
          light: '#BFDBFE',
        },
        income: {
          positive: '#1D4ED8',
          negative: '#1E3A8A',
          light: '#93C5FD',
        },
      }
    : {
        revenue: {
          positive: '#D1D5DB',
          negative: '#9CA3AF',
          light: '#E5E7EB',
        },
        income: {
          positive: '#D1D5DB',
          negative: '#9CA3AF',
          light: '#E5E7EB',
        },
      };

  const getBarColor = (value: number, type: 'revenue' | 'income') => {
    if (value >= 0) {
      return colors[type].positive;
    } else {
      return colors[type].negative;
    }
  };

  const getBarHeight = (value: number) => {
    if (value === 0) return 0;
    return Math.abs((value / range) * chartHeight);
  };

  const getBarY = (value: number) => {
    if (value >= 0) {
      return padding.top + ((yMax - value) / range) * chartHeight;
    } else {
      return padding.top + ((yMax - 0) / range) * chartHeight;
    }
  };

  const renderBar = (x: number, value: number, type: 'revenue' | 'income', index: number) => {
    if (value === 0) return null;

    const barHeight = getBarHeight(value);
    const barY = getBarY(value);
    const color = getBarColor(value, type);

    // Create rounded rectangle path
    const r = Math.min(radius, barWidth / 2, barHeight / 2);
    const isNegative = value < 0;

    let path: string;

    if (isNegative) {
      // Round bottom corners for negative values
      path = `
        M ${x} ${barY}
        L ${x} ${barY + barHeight - r}
        Q ${x} ${barY + barHeight} ${x + r} ${barY + barHeight}
        L ${x + barWidth - r} ${barY + barHeight}
        Q ${x + barWidth} ${barY + barHeight} ${x + barWidth} ${barY + barHeight - r}
        L ${x + barWidth} ${barY}
        Z
      `;
    } else {
      // Round top corners for positive values
      path = `
        M ${x} ${barY + barHeight}
        L ${x} ${barY + r}
        Q ${x} ${barY} ${x + r} ${barY}
        L ${x + barWidth - r} ${barY}
        Q ${x + barWidth} ${barY} ${x + barWidth} ${barY + r}
        L ${x + barWidth} ${barY + barHeight}
        Z
      `;
    }

    return (
      <g key={`${type}-${index}`}>
        <path
          d={path}
          fill={color}
          opacity={0.9}
          style={{
            transition: animate ? `all ${animationDuration}ms ease-out` : undefined,
          }}
        />
        {/* Subtle highlight */}
        <path d={path} fill="url(#highlight)" opacity={0.3} />
      </g>
    );
  };

  const renderStackedBar = (
    x: number,
    revenueValue: number,
    incomeValue: number,
    index: number,
  ) => {
    const totalValue = revenueValue + incomeValue;
    if (totalValue === 0) return null;

    const totalHeight = getBarHeight(totalValue);
    const totalY = getBarY(totalValue);

    const revenueHeight = (Math.abs(revenueValue) / Math.abs(totalValue)) * totalHeight;
    const incomeHeight = totalHeight - revenueHeight;

    const r = Math.min(radius, barWidth / 2, 2);

    return (
      <g key={`stack-${index}`}>
        {/* Revenue segment */}
        <rect
          x={x}
          y={totalY}
          width={barWidth}
          height={revenueHeight}
          fill={colors.revenue.positive}
          rx={totalValue > 0 ? r : 0}
          ry={totalValue > 0 ? r : 0}
          opacity={0.9}
        />
        {/* Income segment */}
        <rect
          x={x}
          y={totalY + revenueHeight}
          width={barWidth}
          height={incomeHeight}
          fill={colors.income.positive}
          rx={totalValue > 0 ? 0 : r}
          ry={totalValue > 0 ? 0 : r}
          opacity={0.9}
        />
      </g>
    );
  };

  return (
    <div className={`inline-block ${className}`} style={{ width, height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible">
        <defs>
          {/* Highlight gradient */}
          <linearGradient id="highlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.4" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Background guides */}
        {showGuides && (
          <g opacity={0.1}>
            {[1, 2, 3].map((i) => (
              <line
                key={i}
                x1={padding.left + i * (chartWidth / 4)}
                y1={padding.top}
                x2={padding.left + i * (chartWidth / 4)}
                y2={height - padding.bottom}
                stroke="currentColor"
                strokeWidth={0.5}
              />
            ))}
          </g>
        )}

        {/* Zero line */}
        {minValue < 0 && maxValue > 0 && (
          <line
            x1={padding.left}
            y1={zeroY}
            x2={width - padding.right}
            y2={zeroY}
            stroke="currentColor"
            strokeWidth={zeroStrokeWidth}
            strokeOpacity={zeroStrokeOpacity}
          />
        )}

        {/* Bars */}
        {Array.from({ length: 4 }, (_, i) => {
          const groupX = padding.left + i * (groupWidth + groupGap);

          if (mode === 'single') {
            const values = singleSeries === 'revenue' ? revenueData : incomeData;
            const type = singleSeries;
            return renderBar(groupX + (groupWidth - barWidth) / 2, values[i], type, i);
          } else if (mode === 'stack') {
            return renderStackedBar(
              groupX + (groupWidth - barWidth) / 2,
              revenueData[i],
              incomeData[i],
              i,
            );
          } else {
            // Group mode
            return (
              <g key={`group-${i}`}>
                {hasRevenue && renderBar(groupX, revenueData[i], 'revenue', i)}
                {hasIncome && renderBar(groupX + barWidth + barSpacing, incomeData[i], 'income', i)}
              </g>
            );
          }
        })}
      </svg>
    </div>
  );
}
