import assert from 'node:assert/strict';

type HealthResponse = {
  ok?: boolean;
  severity?: string;
  failedServices?: string[];
  degradedServices?: string[];
  services?: Record<
    string,
    {
      required?: boolean;
      status?: string;
      detail?: string | null;
      latencyMs?: number | null;
    }
  >;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function main() {
  const baseUrl = trimTrailingSlash(
    process.env.LIBRARY_HEALTH_BASE_URL?.trim() || 'http://127.0.0.1:3000',
  );
  const endpoint = `${baseUrl}/api/health`;

  const response = await fetch(endpoint, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = (await response.json().catch(() => null)) as HealthResponse | null;

  assert.equal(response.ok, true, `health endpoint should return 200, got ${response.status}`);
  assert.equal(payload?.ok, true, 'health payload should report ok=true');

  const requiredFailures = Object.entries(payload?.services ?? {})
    .filter(([, service]) => service?.required !== false && service?.status !== 'ok')
    .map(([name, service]) => `${name}:${service?.status ?? 'unknown'}`);

  assert.deepEqual(requiredFailures, [], 'all required services should be healthy');

  console.log(
    JSON.stringify({
      ok: true,
      endpoint,
      severity: payload?.severity ?? null,
      failedServices: payload?.failedServices ?? [],
      degradedServices: payload?.degradedServices ?? [],
      services: Object.fromEntries(
        Object.entries(payload?.services ?? {}).map(([name, service]) => [
          name,
          {
            status: service?.status ?? null,
            latencyMs: service?.latencyMs ?? null,
            detail: service?.detail ?? null,
          },
        ]),
      ),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
