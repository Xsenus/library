import { NextResponse } from 'next/server';

import { callAiIntegration, getAiIntegrationBase, getAiIntegrationHealth } from '@/lib/ai-integration';
import { dbBitrix } from '@/lib/db-bitrix';
import { db } from '@/lib/db';
import {
  summarizeLibrarySystemHealth,
  type LibraryServiceHealth,
} from '@/lib/library-system-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

const ANALYSIS_SCORE_SYNC_HEALTH_PATH = '/v1/equipment-selection/analysis-score-sync-health';

function formatErrorDetail(error: unknown, fallback: string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return message.trim() || fallback;
}

async function probeRequiredDependency(
  check: () => Promise<void>,
  detailWhenOk: string,
): Promise<LibraryServiceHealth> {
  const startedAt = Date.now();
  try {
    await check();
    return {
      required: true,
      status: 'ok',
      detail: detailWhenOk,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      required: true,
      status: 'error',
      detail: formatErrorDetail(error, 'Dependency probe failed'),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function probeAiIntegrationDependency(): Promise<LibraryServiceHealth> {
  const startedAt = Date.now();
  const health = await getAiIntegrationHealth();

  return {
    required: true,
    status: health.available ? 'ok' : 'error',
    detail: health.detail ?? (health.available ? 'AI integration health is ok' : 'AI integration is unavailable'),
    latencyMs: Date.now() - startedAt,
    meta: {
      base: health.base,
      ok: health.ok ?? null,
      connections: health.connections ?? undefined,
    },
  };
}

async function probeAnalysisScoreSyncDependency(): Promise<LibraryServiceHealth> {
  const base = getAiIntegrationBase();
  if (!base) {
    return {
      required: false,
      status: 'disabled',
      detail: 'AI integration base URL is not configured',
      meta: {
        endpoint: ANALYSIS_SCORE_SYNC_HEALTH_PATH,
      },
    };
  }

  const startedAt = Date.now();
  const response = await callAiIntegration<{ ok?: boolean; detail?: string }>(
    ANALYSIS_SCORE_SYNC_HEALTH_PATH,
    {
      method: 'GET',
      cache: 'no-store',
      timeoutMs: 5_000,
    },
  );

  if (!response.ok) {
    return {
      required: false,
      status: 'error',
      detail: response.error,
      latencyMs: Date.now() - startedAt,
      meta: {
        base,
        endpoint: ANALYSIS_SCORE_SYNC_HEALTH_PATH,
        upstreamStatus: response.status,
      },
    };
  }

  const upstreamOk = response.data?.ok !== false;
  return {
    required: false,
    status: upstreamOk ? 'ok' : 'error',
    detail:
      response.data?.detail ??
      (upstreamOk ? 'analysis_score sync health is ok' : 'analysis_score sync health is degraded'),
    latencyMs: Date.now() - startedAt,
    meta: {
      base,
      endpoint: ANALYSIS_SCORE_SYNC_HEALTH_PATH,
      upstreamStatus: response.status,
    },
  };
}

export async function GET() {
  const services = {
    main_db: await probeRequiredDependency(async () => {
      await db.query('SELECT 1');
    }, 'Primary PostgreSQL connection is ok'),
    bitrix_db: await probeRequiredDependency(async () => {
      await dbBitrix.query('SELECT 1');
    }, 'bitrix_data PostgreSQL connection is ok'),
    ai_integration: await probeAiIntegrationDependency(),
    analysis_score_sync: await probeAnalysisScoreSyncDependency(),
  };

  const summary = summarizeLibrarySystemHealth(services);
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 });
}
