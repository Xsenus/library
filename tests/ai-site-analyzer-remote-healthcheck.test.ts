import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAiSiteAnalyzerRemoteHealthSummary,
  runAiSiteAnalyzerRemoteHealthcheck,
} from '../lib/ai-site-analyzer-remote-healthcheck';

test('buildAiSiteAnalyzerRemoteHealthSummary treats billing provider errors as degraded', () => {
  const summary = buildAiSiteAnalyzerRemoteHealthSummary({
    baseUrl: 'http://37.221.125.221:8123',
    checkedAt: '2026-04-24T09:00:00.000Z',
    healthProbe: {
      url: 'http://37.221.125.221:8123/health',
      httpStatus: 200,
      payload: { ok: true },
      reason: null,
    },
    billingProbe: {
      url: 'http://37.221.125.221:8123/v1/billing/remaining',
      httpStatus: 200,
      payload: {
        configured: true,
        error: 'billing provider error: 403 Forbidden',
        currency: 'usd',
        spent_usd: null,
        remaining_usd: null,
      },
      reason: null,
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.severity, 'degraded');
  assert.equal(summary.reason, 'billing_degraded');
  assert.equal(summary.billing_error, 'billing provider error: 403 Forbidden');
});

test('runAiSiteAnalyzerRemoteHealthcheck writes latest artifact from HTTP probes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-site-remote-health-'));
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          configured: true,
          error: null,
          currency: 'usd',
          spent_usd: 12.5,
          remaining_usd: 87.5,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const summary = await runAiSiteAnalyzerRemoteHealthcheck({
      baseUrl: 'http://example.test/',
      timeoutMs: 1_000,
      artifactDir: tmpDir,
      stateFile: path.join(tmpDir, 'state.json'),
      artifactRetentionCount: 14,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.severity, 'ok');
    assert.equal(fs.existsSync(path.join(tmpDir, 'latest.json')), true);
    assert.equal(fs.existsSync(summary.artifact_path), true);

    const latest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'latest.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(latest.base_url, 'http://example.test');
    assert.equal(latest.health_url, 'http://example.test/health');
    assert.equal(latest.billing_url, 'http://example.test/v1/billing/remaining');
    assert.equal(latest.billing_remaining_usd, 87.5);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
