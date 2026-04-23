export type LibraryServiceStatus = 'ok' | 'error' | 'disabled';
export type LibraryHealthSeverity = 'ok' | 'degraded' | 'failed';

export type LibraryServiceHealth = {
  required: boolean;
  status: LibraryServiceStatus;
  detail?: string | null;
  latencyMs?: number | null;
  meta?: Record<string, unknown>;
};

export type LibrarySystemHealth = {
  ok: boolean;
  severity: LibraryHealthSeverity;
  checkedAt: string;
  failedServices: string[];
  degradedServices: string[];
  services: Record<string, LibraryServiceHealth>;
};

export function summarizeLibrarySystemHealth(
  services: Record<string, LibraryServiceHealth>,
  checkedAt = new Date().toISOString(),
): LibrarySystemHealth {
  const entries = Object.entries(services);
  const failedServices = entries
    .filter(([, service]) => service.required && service.status !== 'ok')
    .map(([name]) => name);
  const degradedServices = entries
    .filter(([, service]) => !service.required && service.status === 'error')
    .map(([name]) => name);

  const severity: LibraryHealthSeverity = failedServices.length
    ? 'failed'
    : degradedServices.length
      ? 'degraded'
      : 'ok';

  return {
    ok: failedServices.length === 0,
    severity,
    checkedAt,
    failedServices,
    degradedServices,
    services,
  };
}
