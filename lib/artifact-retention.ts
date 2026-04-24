import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_ARTIFACT_RETENTION = 14;

export type ArtifactRetentionEntry = {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  mtimeMs: number;
};

export type PruneArtifactEntriesOptions = {
  rootDir: string;
  keepLatest: number;
  preserveNames?: string[];
  matchEntry?: (entry: ArtifactRetentionEntry) => boolean;
};

export function parseArtifactRetentionCount(
  value: string | number | null | undefined,
  defaultValue = DEFAULT_ARTIFACT_RETENTION,
): number {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }

  return Math.trunc(parsed);
}

export function isTimestampedArtifactRunDirectory(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/i.test(name);
}

export async function pruneArtifactEntries({
  rootDir,
  keepLatest,
  preserveNames = [],
  matchEntry,
}: PruneArtifactEntriesOptions): Promise<string[]> {
  if (!Number.isFinite(keepLatest) || keepLatest <= 0) {
    return [];
  }

  let dirEntries;
  try {
    dirEntries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const preserved = new Set(preserveNames);
  const candidates: ArtifactRetentionEntry[] = [];

  for (const dirEntry of dirEntries) {
    if (preserved.has(dirEntry.name)) {
      continue;
    }

    const fullPath = path.join(rootDir, dirEntry.name);
    const stats = await stat(fullPath).catch(() => null);
    if (!stats) {
      continue;
    }

    const candidate: ArtifactRetentionEntry = {
      name: dirEntry.name,
      fullPath,
      isDirectory: dirEntry.isDirectory(),
      mtimeMs: stats.mtimeMs,
    };
    if (matchEntry && !matchEntry(candidate)) {
      continue;
    }
    candidates.push(candidate);
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  const toDelete = candidates.slice(keepLatest);

  for (const entry of toDelete) {
    await rm(entry.fullPath, { recursive: true, force: true });
  }

  return toDelete.map((entry) => entry.fullPath);
}
