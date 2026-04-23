import assert from 'node:assert/strict';
import test from 'node:test';

import { b24BatchJson, b24Call, getPortalOrigin } from '../lib/b24';

async function withB24Env<T>(
  env: { webhook?: string; portalOrigin?: string },
  fn: () => T | Promise<T>,
): Promise<T> {
  const previousWebhook = process.env.B24_WEBHOOK_URL;
  const previousPortalOrigin = process.env.B24_PORTAL_ORIGIN;

  try {
    if (env.webhook === undefined) {
      delete process.env.B24_WEBHOOK_URL;
    } else {
      process.env.B24_WEBHOOK_URL = env.webhook;
    }

    if (env.portalOrigin === undefined) {
      delete process.env.B24_PORTAL_ORIGIN;
    } else {
      process.env.B24_PORTAL_ORIGIN = env.portalOrigin;
    }

    return await fn();
  } finally {
    if (previousWebhook === undefined) {
      delete process.env.B24_WEBHOOK_URL;
    } else {
      process.env.B24_WEBHOOK_URL = previousWebhook;
    }

    if (previousPortalOrigin === undefined) {
      delete process.env.B24_PORTAL_ORIGIN;
    } else {
      process.env.B24_PORTAL_ORIGIN = previousPortalOrigin;
    }
  }
}

test('getPortalOrigin resolves lazily from current Bitrix env', async () => {
  await withB24Env({ webhook: 'https://portal.example/rest/1/token/' }, () => {
    assert.equal(getPortalOrigin(), 'https://portal.example');
  });

  await withB24Env(
    {
      webhook: 'https://portal.example/rest/1/token/',
      portalOrigin: 'https://custom.example',
    },
    () => {
      assert.equal(getPortalOrigin(), 'https://custom.example');
    },
  );
});

test('importing B24 client does not warn when env is absent', async () => {
  await withB24Env({}, async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      await import(`../lib/b24?no-warn=${Date.now()}`);
      assert.deepEqual(warnings, []);
    } finally {
      console.warn = originalWarn;
    }
  });
});

test('b24 calls fail without noisy module-level config warnings', async () => {
  await withB24Env({}, async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      await assert.rejects(() => b24Call('crm.company.list'), /B24 webhook not configured/);
      await assert.rejects(() => b24BatchJson({ test: 'crm.company.list' }), /B24 webhook not configured/);
      assert.deepEqual(warnings, []);
    } finally {
      console.warn = originalWarn;
    }
  });
});

test('b24Call reads webhook at call time', async () => {
  await withB24Env({ webhook: 'https://portal.example/rest/1/token/' }, async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    let requestBody = '';

    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ result: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const result = await b24Call<{ ok: boolean }>('crm.test', {
        filter: { ID: 123 },
        select: ['ID', 'TITLE'],
      });

      assert.deepEqual(result, { ok: true });
      assert.equal(requestedUrl, 'https://portal.example/rest/1/token/crm.test.json');
      assert.match(requestBody, /filter%5BID%5D=123/);
      assert.match(requestBody, /select%5B%5D=ID/);
      assert.match(requestBody, /select%5B%5D=TITLE/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('b24BatchJson posts to current webhook batch endpoint', async () => {
  await withB24Env({ webhook: 'https://portal.example/rest/1/token/' }, async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    let parsedBody: unknown = null;

    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      parsedBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ result: { result: { a: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const result = await b24BatchJson({ a: 'crm.company.list?start=-1' }, 1);

      assert.deepEqual(result, { result: { result: { a: [] } } });
      assert.equal(requestedUrl, 'https://portal.example/rest/1/token/batch.json');
      assert.deepEqual(parsedBody, { halt: 1, cmd: { a: 'crm.company.list?start=-1' } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
