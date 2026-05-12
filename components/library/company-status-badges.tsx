'use client';

import type { CSSProperties } from 'react';

export function hasRevenueGrowth(current: number | null | undefined, previous: number | null | undefined): boolean {
  return typeof current === 'number' && Number.isFinite(current)
    && typeof previous === 'number' && Number.isFinite(previous)
    && current > previous;
}

export function formatAnalysisScore(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const normalized = score <= 1 ? score * 10 : score;
  return normalized.toFixed(1);
}

export function getAnalysisScoreBadgeStyle(score: number | null | undefined): CSSProperties {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  const normalized = Math.max(0, Math.min(1, (value - 0.85) / 0.1));
  const start = { r: 55, g: 65, b: 81 };
  const end = { r: 22, g: 163, b: 74 };
  const r = Math.round(start.r + (end.r - start.r) * normalized);
  const g = Math.round(start.g + (end.g - start.g) * normalized);
  const b = Math.round(start.b + (end.b - start.b) * normalized);

  return {
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    color: '#ffffff',
  };
}

type CompanyStatusBadgesProps = {
  inPp719?: boolean | null;
  revenueGrowing?: boolean;
  analysisScore?: number | null;
  className?: string;
};

export function CompanyStatusBadges({
  inPp719,
  revenueGrowing,
  analysisScore,
  className = '',
}: CompanyStatusBadgesProps) {
  const scoreText = formatAnalysisScore(analysisScore);
  if (!inPp719 && !revenueGrowing && !scoreText) return null;

  const baseClass = 'inline-flex h-5 items-center rounded px-1.5 text-[10px] font-bold leading-none';

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {inPp719 && <span className={`${baseClass} bg-blue-600 text-white`}>719</span>}
      {revenueGrowing && <span className={`${baseClass} bg-lime-500 text-lime-950`}>Рост</span>}
      {scoreText && (
        <span className={baseClass} style={getAnalysisScoreBadgeStyle(analysisScore)} title="Балл анализа">
          {scoreText}
        </span>
      )}
    </div>
  );
}
