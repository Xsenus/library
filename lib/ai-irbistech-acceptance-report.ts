import path from 'node:path';

export type AiIrbistechAcceptanceReportCategory = 'backend' | 'frontend' | 'service_chain';
export type AiIrbistechAcceptanceReportCheckStatus = 'pass' | 'warn' | 'fail' | 'missing';
export type AiIrbistechAcceptanceReportOverallStatus = 'ready' | 'ready_with_warnings' | 'not_ready' | 'incomplete';

export type AiIrbistechAcceptanceReportSource = {
  inputPath?: string | null;
  payload: unknown;
};

export type AiIrbistechAcceptanceReportSources = {
  aiIntegrationAcceptance?: AiIrbistechAcceptanceReportSource | null;
  aiIntegrationSqlReadiness?: AiIrbistechAcceptanceReportSource | null;
  aiIntegrationSyncHealth?: AiIrbistechAcceptanceReportSource | null;
  libraryHealth?: AiIrbistechAcceptanceReportSource | null;
  libraryAcceptance?: AiIrbistechAcceptanceReportSource | null;
  libraryUiSmoke?: AiIrbistechAcceptanceReportSource | null;
  libraryUiQa?: AiIrbistechAcceptanceReportSource | null;
  aiSiteAnalyzerHealth?: AiIrbistechAcceptanceReportSource | null;
};

export type AiIrbistechAcceptanceReportCheck = {
  id: keyof AiIrbistechAcceptanceReportSources;
  title: string;
  category: AiIrbistechAcceptanceReportCategory;
  status: AiIrbistechAcceptanceReportCheckStatus;
  checkedAt: string | null;
  summary: string;
  sourcePath: string | null;
  artifactPath: string | null;
  details: string[];
};

export type AiIrbistechAcceptanceReportSnapshot = {
  generatedAt: string;
  overallStatus: AiIrbistechAcceptanceReportOverallStatus;
  releaseReady: boolean;
  counts: Record<AiIrbistechAcceptanceReportCheckStatus, number>;
  checks: AiIrbistechAcceptanceReportCheck[];
  passedCheckIds: string[];
  warningCheckIds: string[];
  failedCheckIds: string[];
  missingCheckIds: string[];
};

export function isAiIrbistechAcceptanceReportClean(
  snapshot: AiIrbistechAcceptanceReportSnapshot,
): boolean {
  return snapshot.overallStatus === 'ready';
}

export function resolveAiIrbistechAcceptanceReportExitCode(
  snapshot: AiIrbistechAcceptanceReportSnapshot,
  {
    requireReleaseReady = false,
    requireClean = false,
  }: {
    requireReleaseReady?: boolean;
    requireClean?: boolean;
  } = {},
): number {
  if (requireClean && !isAiIrbistechAcceptanceReportClean(snapshot)) {
    return 1;
  }
  if (requireReleaseReady && !snapshot.releaseReady) {
    return 1;
  }
  return 0;
}

type CheckSpec = {
  id: keyof AiIrbistechAcceptanceReportSources;
  title: string;
  category: AiIrbistechAcceptanceReportCategory;
  build: (source: AiIrbistechAcceptanceReportSource | null | undefined) => AiIrbistechAcceptanceReportCheck;
};

type RecordLike = Record<string, unknown>;

const CHECK_SPECS: CheckSpec[] = [
  {
    id: 'aiIntegrationAcceptance',
    title: 'ai-integration: acceptance проверки формулы',
    category: 'backend',
    build: buildAiIntegrationAcceptanceCheck,
  },
  {
    id: 'aiIntegrationSqlReadiness',
    title: 'ai-integration: SQL readiness analysis_score',
    category: 'backend',
    build: buildAiIntegrationSqlReadinessCheck,
  },
  {
    id: 'aiIntegrationSyncHealth',
    title: 'ai-integration: health sync analysis_score',
    category: 'backend',
    build: buildAiIntegrationSyncHealthCheck,
  },
  {
    id: 'libraryHealth',
    title: 'library: /api/health',
    category: 'frontend',
    build: buildLibraryHealthCheck,
  },
  {
    id: 'libraryAcceptance',
    title: 'library: acceptance trace healthcheck',
    category: 'frontend',
    build: buildLibraryAcceptanceCheck,
  },
  {
    id: 'libraryUiSmoke',
    title: 'library: AI Analysis UI smoke',
    category: 'frontend',
    build: buildLibraryUiSmokeCheck,
  },
  {
    id: 'libraryUiQa',
    title: 'library: AI Analysis UI QA',
    category: 'frontend',
    build: buildLibraryUiQaCheck,
  },
  {
    id: 'aiSiteAnalyzerHealth',
    title: 'ai-site-analyzer: system health',
    category: 'service_chain',
    build: buildAiSiteAnalyzerHealthCheck,
  },
];

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function displayPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return normalizePathSeparators(path.resolve(value));
}

function asRecord(value: unknown): RecordLike | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RecordLike) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function formatNumber(value: number | null, fractionDigits = 4): string {
  return value === null ? 'n/a' : value.toFixed(fractionDigits);
}

function artifactPathFromPayload(payload: RecordLike | null): string | null {
  if (!payload) {
    return null;
  }
  return displayPath(asString(payload.artifact_path) ?? asString(payload.artifactPath));
}

function targetSummary(target: RecordLike | null): string {
  if (!target) {
    return 'n/a';
  }

  const parts = [
    `required=${asBoolean(target.required) === true ? 'yes' : 'no'}`,
    `configured=${asBoolean(target.configured) === true ? 'yes' : 'no'}`,
  ];

  const tableExists = asBoolean(target.table_exists);
  if (tableExists !== null) {
    parts.push(`table=${tableExists ? 'yes' : 'no'}`);
  }
  const columnExists = asBoolean(target.column_exists);
  if (columnExists !== null) {
    parts.push(`column=${columnExists ? 'yes' : 'no'}`);
  }
  const indexExists = asBoolean(target.index_exists);
  if (indexExists !== null) {
    parts.push(`index=${indexExists ? 'yes' : 'no'}`);
  }
  const note = asString(target.note);
  if (note) {
    parts.push(`note=${note}`);
  }

  return parts.join(', ');
}

function sqlArtifactSummary(artifacts: RecordLike | null): string {
  if (!artifacts) {
    return 'n/a';
  }

  const notes = Object.entries(artifacts).flatMap(([name, value]) => {
    const record = asRecord(value);
    if (!record) {
      return [];
    }
    const exists = asBoolean(record.exists);
    const itemPath = asString(record.path);
    return [`${name}:${exists === true ? 'present' : 'missing'}${itemPath ? `:${itemPath}` : ''}`];
  });

  return notes.length ? notes.join('; ') : 'n/a';
}

function nonOkServiceSummary(services: RecordLike | null): string {
  if (!services) {
    return 'none';
  }

  const notes = Object.entries(services)
    .flatMap(([name, service]) => {
      const record = asRecord(service);
      if (!record) {
        return [];
      }
      const status = asString(record.status);
      if (!status || status === 'ok') {
        return [];
      }
      const detail = asString(record.detail);
      return [`${name}:${status}${detail ? `:${detail}` : ''}`];
    });

  return notes.length ? notes.join('; ') : 'none';
}

function summarizeBackendAcceptanceCases(cases: unknown[]): { text: string; maxFormulaDelta: number | null } {
  const notes: string[] = [];
  let maxFormulaDelta: number | null = null;

  for (const item of cases) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const name = asString(record.name) ?? 'unknown-case';
    const ok = asBoolean(record.ok) !== false;
    const source = asString(record.source);
    const finalScore = asNumber(record.final_score);
    const formulaDelta = asNumber(record.formula_delta);
    if (formulaDelta !== null && (maxFormulaDelta === null || formulaDelta > maxFormulaDelta)) {
      maxFormulaDelta = formulaDelta;
    }
    if (!ok) {
      notes.push(`${name}: failed (${asString(record.error) ?? 'unknown_error'})`);
      continue;
    }
    notes.push(
      `${name}: source=${source ?? 'n/a'}, final=${formatNumber(finalScore)}, delta=${formatNumber(formulaDelta, 6)}`,
    );
  }

  return {
    text: notes.length ? notes.join('; ') : 'none',
    maxFormulaDelta,
  };
}

function summarizeFrontendAcceptanceCases(cases: unknown[]): string {
  const notes = cases.flatMap((item) => {
    const record = asRecord(item);
    if (!record) {
      return [];
    }
    const name = asString(record.name) ?? 'unknown-case';
    const ok = asBoolean(record.ok) !== false;
    if (!ok) {
      return [`${name}: failed (${asString(record.error) ?? 'unknown_error'})`];
    }
    const finalSource = asString(record.finalSource);
    const originKind = asString(record.originKind);
    return [`${name}: path=${finalSource ?? 'n/a'}, origin=${originKind ?? 'n/a'}`];
  });

  return notes.length ? notes.join('; ') : 'none';
}

function summarizeUiQaCases(cases: unknown[]): string {
  const notes = cases.flatMap((item) => {
    const record = asRecord(item);
    if (!record) {
      return [];
    }
    const name = asString(record.name) ?? 'unknown-case';
    const ok = asBoolean(record.ok) === true;
    if (!ok) {
      return [`${name}: failed (${asString(record.error) ?? 'unknown_error'})`];
    }
    const finalSource = asString(record.finalSource);
    const originKind = asString(record.originKind);
    return [`${name}: path=${finalSource ?? 'n/a'}, origin=${originKind ?? 'n/a'}`];
  });

  return notes.length ? notes.join('; ') : 'none';
}

function buildMissingCheck(
  id: keyof AiIrbistechAcceptanceReportSources,
  title: string,
  category: AiIrbistechAcceptanceReportCategory,
): AiIrbistechAcceptanceReportCheck {
  return {
    id,
    title,
    category,
    status: 'missing',
    checkedAt: null,
    summary: 'Артефакт проверки не передан',
    sourcePath: null,
    artifactPath: null,
    details: ['Для этого блока не был передан JSON summary/latest.json.'],
  };
}

function buildInvalidPayloadCheck(
  id: keyof AiIrbistechAcceptanceReportSources,
  title: string,
  category: AiIrbistechAcceptanceReportCategory,
  source: AiIrbistechAcceptanceReportSource,
): AiIrbistechAcceptanceReportCheck {
  return {
    id,
    title,
    category,
    status: 'fail',
    checkedAt: null,
    summary: 'JSON-артефакт не удалось распознать',
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: null,
    details: ['Ожидался JSON-объект верхнего уровня.'],
  };
}

function buildAiIntegrationAcceptanceCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[0]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const failedCases = asStringArray(payload.failed_cases);
  const caseSummary = summarizeBackendAcceptanceCases(asArray(payload.cases));
  const health = asRecord(payload.health);
  const healthOk = asBoolean(health?.ok);
  const httpStatus = asNumber(health?.http_status);
  const healthError = asString(health?.error);
  const reason = asString(payload.reason) ?? (ok ? 'ok' : 'reported_unhealthy');

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status: ok ? 'pass' : 'fail',
    checkedAt: asString(payload.checked_at),
    summary: `reason=${reason}, failed_cases=${failedCases.length || 0}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Health endpoint: ${healthOk === true ? 'ok' : 'not_ok'}${httpStatus !== null ? `, http=${httpStatus}` : ''}`,
      `Health error: ${healthError ?? 'none'}`,
      `Failed cases: ${failedCases.length ? failedCases.join(', ') : 'none'}`,
      `Case summary: ${caseSummary.text}`,
      `Max formula delta: ${formatNumber(caseSummary.maxFormulaDelta, 6)}`,
    ],
  };
}

function buildAiIntegrationSyncHealthCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[2]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const counters = asRecord(payload.counters);
  const counterKeys = ['total', 'local_failed', 'bitrix_failed', 'local_skipped', 'bitrix_skipped'];
  const counterSummary = counterKeys
    .flatMap((key) => {
      const value = asNumber(counters?.[key]);
      return value === null ? [] : [`${key}=${value}`];
    })
    .join(', ');
  const reason = asString(payload.reason) ?? (ok ? 'ok' : 'reported_unhealthy');

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status: ok ? 'pass' : 'fail',
    checkedAt: asString(payload.checked_at),
    summary: `reason=${reason}${counterSummary ? `, ${counterSummary}` : ''}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `URL: ${asString(payload.url) ?? 'n/a'}`,
      `HTTP status: ${asNumber(payload.http_status) ?? 'n/a'}`,
      `Counters: ${counterSummary || 'n/a'}`,
      `Local target: ${targetSummary(asRecord(payload.local_target))}`,
      `Bitrix target: ${targetSummary(asRecord(payload.bitrix_target))}`,
    ],
  };
}

function buildAiIntegrationSqlReadinessCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[1]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const reason = asString(payload.reason) ?? (ok ? 'ok' : 'reported_unhealthy');
  const counters = asRecord(payload.counters);
  const optionalFailed = asNumber(counters?.optional_failed) ?? 0;
  const requiredFailed = asNumber(counters?.required_failed) ?? 0;
  const status: AiIrbistechAcceptanceReportCheckStatus = !ok ? 'fail' : optionalFailed > 0 ? 'warn' : 'pass';
  const policy = asRecord(payload.policy);
  const policySummary = [
    `postgres_required=${asBoolean(policy?.postgres_required) === true ? 'yes' : 'no'}`,
    `bitrix_required=${asBoolean(policy?.bitrix_required) === true ? 'yes' : 'no'}`,
  ].join(', ');
  const counterKeys = ['total', 'configured', 'required', 'schema_ready', 'effective_ok', 'required_failed', 'optional_failed'];
  const counterSummary = counterKeys
    .flatMap((key) => {
      const value = asNumber(counters?.[key]);
      return value === null ? [] : [`${key}=${value}`];
    })
    .join(', ');

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status,
    checkedAt: asString(payload.checked_at),
    summary: `reason=${reason}, required_failed=${requiredFailed}, optional_failed=${optionalFailed}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Policy: ${policySummary}`,
      `Counters: ${counterSummary || 'n/a'}`,
      `Postgres target: ${targetSummary(asRecord(payload.postgres_target))}`,
      `Bitrix target: ${targetSummary(asRecord(payload.bitrix_target))}`,
      `SQL artifacts: ${sqlArtifactSummary(asRecord(payload.sql_artifacts))}`,
    ],
  };
}

function buildLibraryHealthCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[3]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const severity = asString(payload.severity) ?? (ok ? 'ok' : 'failed');
  const status: AiIrbistechAcceptanceReportCheckStatus = !ok ? 'fail' : severity === 'degraded' ? 'warn' : 'pass';
  const failedServices = asStringArray(payload.failedServices);
  const degradedServices = asStringArray(payload.degradedServices);
  const reason = asString(payload.reason) ?? (ok ? 'ok' : 'reported_unhealthy');

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status,
    checkedAt: asString(payload.checkedAt),
    summary: `severity=${severity}, reason=${reason}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Health URL: ${asString(payload.url) ?? 'n/a'}`,
      `HTTP status: ${asNumber(payload.httpStatus) ?? 'n/a'}`,
      `Failed services: ${failedServices.length ? failedServices.join(', ') : 'none'}`,
      `Degraded services: ${degradedServices.length ? degradedServices.join(', ') : 'none'}`,
      `Non-ok service notes: ${nonOkServiceSummary(asRecord(payload.services))}`,
    ],
  };
}

function buildLibraryAcceptanceCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[4]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const failedCases = asStringArray(payload.failedCases);
  const health = asRecord(payload.health);
  const healthOk = asBoolean(health?.ok);
  const healthError = asString(health?.error);
  const reason = asString(payload.reason) ?? (ok ? 'ok' : 'reported_unhealthy');

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status: ok ? 'pass' : 'fail',
    checkedAt: asString(payload.checkedAt),
    summary: `reason=${reason}, failed_cases=${failedCases.length || 0}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Base URL: ${asString(payload.baseUrl) ?? 'n/a'}`,
      `Health: ${healthOk === true ? 'ok' : 'not_ok'}`,
      `Health error: ${healthError ?? 'none'}`,
      `Failed cases: ${failedCases.length ? failedCases.join(', ') : 'none'}`,
      `Case summary: ${summarizeFrontendAcceptanceCases(asArray(payload.cases))}`,
    ],
  };
}

function buildLibraryUiSmokeCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[5]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const requireAuth = asBoolean(payload.requireAuth) === true;
  const authenticated = asBoolean(payload.authenticated) === true;
  const aiAnalysisLoaded = asBoolean(payload.aiAnalysisLoaded) === true;
  const companyDialogOpened = asBoolean(payload.companyDialogOpened) === true;
  const error = asString(payload.error);

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status: ok ? 'pass' : 'fail',
    checkedAt: asString(payload.checkedAt),
    summary: `mode=${asString(payload.mode) ?? 'n/a'}, authenticated=${authenticated ? 'yes' : 'no'}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Base URL: ${asString(payload.baseUrl) ?? 'n/a'}`,
      `Require auth: ${requireAuth ? 'yes' : 'no'}`,
      `Public redirect path: ${asString(payload.publicRedirectPath) ?? 'n/a'}`,
      `AI Analysis loaded: ${aiAnalysisLoaded ? 'yes' : 'no'}`,
      `Company dialog opened: ${companyDialogOpened ? 'yes' : 'no'}`,
      `Screenshots: ${asArray(payload.screenshots).length}`,
      `Error: ${error ?? 'none'}`,
    ],
  };
}

function buildLibraryUiQaCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[6]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const failedCases = asArray(payload.cases)
    .map((item) => asRecord(item))
    .filter((item): item is RecordLike => Boolean(item))
    .filter((item) => asBoolean(item.ok) !== true)
    .map((item) => asString(item.name) ?? 'unknown-case');
  const error = asString(payload.error);

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status: ok ? 'pass' : 'fail',
    checkedAt: asString(payload.checkedAt),
    summary: `authenticated=${asBoolean(payload.authenticated) === true ? 'yes' : 'no'}, failed_cases=${failedCases.length}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Base URL: ${asString(payload.baseUrl) ?? 'n/a'}`,
      `Public redirect path: ${asString(payload.publicRedirectPath) ?? 'n/a'}`,
      `Failed cases: ${failedCases.length ? failedCases.join(', ') : 'none'}`,
      `Case summary: ${summarizeUiQaCases(asArray(payload.cases))}`,
      `Screenshots: ${asArray(payload.screenshots).length}`,
      `Error: ${error ?? 'none'}`,
    ],
  };
}

function buildAiSiteAnalyzerHealthCheck(
  source: AiIrbistechAcceptanceReportSource | null | undefined,
): AiIrbistechAcceptanceReportCheck {
  const spec = CHECK_SPECS[7]!;
  if (!source) {
    return buildMissingCheck(spec.id, spec.title, spec.category);
  }

  const payload = asRecord(source.payload);
  if (!payload) {
    return buildInvalidPayloadCheck(spec.id, spec.title, spec.category, source);
  }

  const ok = asBoolean(payload.ok) === true;
  const severity = asString(payload.severity) ?? (ok ? 'ok' : 'unhealthy');
  const status: AiIrbistechAcceptanceReportCheckStatus = !ok ? 'fail' : severity === 'degraded' ? 'warn' : 'pass';
  const billingConfigured = asBoolean(payload.billing_configured);
  const billingError = asString(payload.billing_error);
  const remainingUsd = asNumber(payload.billing_remaining_usd);
  const spentUsd = asNumber(payload.billing_spent_usd);
  const currency = asString(payload.billing_currency);
  const reason = asString(payload.reason) ?? (ok ? 'ok' : 'reported_unhealthy');

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status,
    checkedAt: asString(payload.checked_at),
    summary: `severity=${severity}, reason=${reason}`,
    sourcePath: displayPath(source.inputPath) ?? null,
    artifactPath: artifactPathFromPayload(payload),
    details: [
      `Base URL: ${asString(payload.base_url) ?? 'n/a'}`,
      `Health HTTP status: ${asNumber(payload.health_http_status) ?? 'n/a'}`,
      `Billing HTTP status: ${asNumber(payload.billing_http_status) ?? 'n/a'}`,
      `Billing configured: ${
        billingConfigured === null ? 'n/a' : billingConfigured ? 'yes' : 'no'
      }`,
      `Billing error: ${billingError ?? 'none'}`,
      `Billing totals: spent=${formatNumber(spentUsd, 2)} ${currency ?? 'USD'}, remaining=${formatNumber(
        remainingUsd,
        2,
      )} ${currency ?? 'USD'}`,
    ],
  };
}

export function buildAiIrbistechAcceptanceReportSnapshot(
  sources: AiIrbistechAcceptanceReportSources,
  {
    generatedAt = new Date().toISOString(),
  }: {
    generatedAt?: string;
  } = {},
): AiIrbistechAcceptanceReportSnapshot {
  const checks = CHECK_SPECS.map((spec) => spec.build(sources[spec.id]));
  const counts: Record<AiIrbistechAcceptanceReportCheckStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    missing: 0,
  };

  for (const check of checks) {
    counts[check.status] += 1;
  }

  const passedCheckIds = checks.filter((check) => check.status === 'pass').map((check) => check.id);
  const warningCheckIds = checks.filter((check) => check.status === 'warn').map((check) => check.id);
  const failedCheckIds = checks.filter((check) => check.status === 'fail').map((check) => check.id);
  const missingCheckIds = checks.filter((check) => check.status === 'missing').map((check) => check.id);

  let overallStatus: AiIrbistechAcceptanceReportOverallStatus;
  if (counts.fail > 0) {
    overallStatus = 'not_ready';
  } else if (counts.missing > 0) {
    overallStatus = 'incomplete';
  } else if (counts.warn > 0) {
    overallStatus = 'ready_with_warnings';
  } else {
    overallStatus = 'ready';
  }

  return {
    generatedAt,
    overallStatus,
    releaseReady: counts.fail === 0 && counts.missing === 0,
    counts,
    checks,
    passedCheckIds,
    warningCheckIds,
    failedCheckIds,
    missingCheckIds,
  };
}

function overallStatusDescription(status: AiIrbistechAcceptanceReportOverallStatus): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'ready_with_warnings':
      return 'ready_with_warnings';
    case 'not_ready':
      return 'not_ready';
    case 'incomplete':
      return 'incomplete';
    default:
      return status;
  }
}

function categoryTitle(category: AiIrbistechAcceptanceReportCategory): string {
  switch (category) {
    case 'backend':
      return 'Backend';
    case 'frontend':
      return 'Frontend';
    case 'service_chain':
      return 'Service Chain';
    default:
      return category;
  }
}

export function renderAiIrbistechAcceptanceReportMarkdown(
  snapshot: AiIrbistechAcceptanceReportSnapshot,
): string {
  const lines = [
    '# AI IRBISTECH 1.1 Acceptance Report',
    '',
    '## Summary',
    '',
    `- generated at: \`${snapshot.generatedAt}\``,
    `- overall status: \`${overallStatusDescription(snapshot.overallStatus)}\``,
    `- release ready: \`${snapshot.releaseReady ? 'yes' : 'no'}\``,
    `- passed checks: \`${snapshot.counts.pass}\``,
    `- warning checks: \`${snapshot.counts.warn}\``,
    `- failed checks: \`${snapshot.counts.fail}\``,
    `- missing checks: \`${snapshot.counts.missing}\``,
    '',
  ];

  if (snapshot.failedCheckIds.length) {
    lines.push('## Blocking Items', '');
    for (const check of snapshot.checks.filter((item) => item.status === 'fail')) {
      lines.push(`- \`${check.id}\`: ${check.summary}`);
    }
    lines.push('');
  }

  if (snapshot.warningCheckIds.length) {
    lines.push('## Warnings', '');
    for (const check of snapshot.checks.filter((item) => item.status === 'warn')) {
      lines.push(`- \`${check.id}\`: ${check.summary}`);
    }
    lines.push('');
  }

  if (snapshot.missingCheckIds.length) {
    lines.push('## Missing Inputs', '');
    for (const check of snapshot.checks.filter((item) => item.status === 'missing')) {
      lines.push(`- \`${check.id}\`: ${check.summary}`);
    }
    lines.push('');
  }

  for (const category of ['backend', 'frontend', 'service_chain'] as const) {
    const checks = snapshot.checks.filter((item) => item.category === category);
    lines.push(`## ${categoryTitle(category)}`, '');

    for (const check of checks) {
      lines.push(`### ${check.title}`, '');
      lines.push(`- status: \`${check.status}\``);
      lines.push(`- checked at: \`${check.checkedAt ?? 'n/a'}\``);
      lines.push(`- summary: \`${check.summary}\``);
      lines.push(`- input source: \`${check.sourcePath ?? 'n/a'}\``);
      if (check.artifactPath) {
        lines.push(`- evidence artifact: \`${check.artifactPath}\``);
      }
      for (const detail of check.details) {
        lines.push(`- ${detail}`);
      }
      lines.push('');
    }
  }

  lines.push('## Notes', '');
  lines.push('- This report is assembled from JSON artifacts produced by rollout, smoke, QA, and healthcheck scripts.');
  lines.push('- Mark the release as complete only after replacing any `missing` or `fail` statuses with fresh live-run artifacts.');
  lines.push('- `ready_with_warnings` is acceptable only when the remaining warnings are explicitly agreed upon operational deviations.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}
