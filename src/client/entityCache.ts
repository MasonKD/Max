export type GoalCacheEntry = {
  goalId: string;
  title?: string;
  category?: string;
  dueLabel?: string;
  progressLabel?: string;
  taskPanelState?: "tasks_present" | "add_tasks" | "empty";
  taskSummaryLabel?: string;
  taskPreviewItems?: string[];
  lastSeenAt: string;
};

export type DesireCacheEntry = {
  desireId: string;
  title?: string;
  category?: string;
  lastSeenAt: string;
};

export type SessionEntityCache = {
  goalsById: Record<string, GoalCacheEntry>;
  desiresById: Record<string, DesireCacheEntry>;
};

function normalizeKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function assertUniqueGoalTitle(cache: SessionEntityCache, goalId: string, title?: string): void {
  const normalizedTitle = normalizeKey(title);
  if (!normalizedTitle) return;
  for (const entry of Object.values(cache.goalsById)) {
    if (entry.goalId === goalId) continue;
    if (normalizeKey(entry.title) === normalizedTitle) {
      throw new Error(`goal title collision in cache: "${title}" is already linked to goalId ${entry.goalId}`);
    }
  }
}

function assertUniqueDesireTitle(cache: SessionEntityCache, desireId: string, title?: string): void {
  const normalizedTitle = normalizeKey(title);
  if (!normalizedTitle) return;
  for (const entry of Object.values(cache.desiresById)) {
    if (entry.desireId === desireId) continue;
    if (normalizeKey(entry.title) === normalizedTitle) {
      throw new Error(`desire title collision in cache: "${title}" is already linked to desireId ${entry.desireId}`);
    }
  }
}

export function createSessionEntityCache(): SessionEntityCache {
  return { goalsById: {}, desiresById: {} };
}

export function cacheGoal(
  cache: SessionEntityCache,
  entry: {
    goalId: string;
    title?: string;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
    taskPanelState?: "tasks_present" | "add_tasks" | "empty";
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
  }
): void {
  const existing = cache.goalsById[entry.goalId];
  if (existing?.title && entry.title && normalizeKey(existing.title) !== normalizeKey(entry.title)) {
    throw new Error(`goal identity mismatch in cache for ${entry.goalId}: title changed from "${existing.title}" to "${entry.title}"`);
  }
  if (existing?.category && entry.category && normalizeKey(existing.category) !== normalizeKey(entry.category)) {
    throw new Error(`goal identity mismatch in cache for ${entry.goalId}: category changed from "${existing.category}" to "${entry.category}"`);
  }
  assertUniqueGoalTitle(cache, entry.goalId, entry.title ?? existing?.title);
  cache.goalsById[entry.goalId] = {
    goalId: entry.goalId,
    title: entry.title ?? existing?.title,
    category: entry.category ?? existing?.category,
    dueLabel: entry.dueLabel ?? existing?.dueLabel,
    progressLabel: entry.progressLabel ?? existing?.progressLabel,
    taskPanelState: entry.taskPanelState ?? existing?.taskPanelState,
    taskSummaryLabel: entry.taskSummaryLabel ?? existing?.taskSummaryLabel,
    taskPreviewItems: entry.taskPreviewItems ?? existing?.taskPreviewItems,
    lastSeenAt: new Date().toISOString()
  };
}

export function cacheDesire(
  cache: SessionEntityCache,
  entry: {
    desireId: string;
    title?: string;
    category?: string;
  }
): void {
  const existing = cache.desiresById[entry.desireId];
  if (existing?.title && entry.title && normalizeKey(existing.title) !== normalizeKey(entry.title)) {
    throw new Error(`desire identity mismatch in cache for ${entry.desireId}: title changed from "${existing.title}" to "${entry.title}"`);
  }
  if (existing?.category && entry.category && normalizeKey(existing.category) !== normalizeKey(entry.category)) {
    throw new Error(`desire identity mismatch in cache for ${entry.desireId}: category changed from "${existing.category}" to "${entry.category}"`);
  }
  assertUniqueDesireTitle(cache, entry.desireId, entry.title ?? existing?.title);
  cache.desiresById[entry.desireId] = {
    desireId: entry.desireId,
    title: entry.title ?? existing?.title,
    category: entry.category ?? existing?.category,
    lastSeenAt: new Date().toISOString()
  };
}

export function findGoalIdByTitle(cache: SessionEntityCache, title: string): string | undefined {
  const normalized = normalizeKey(title);
  if (!normalized) return undefined;
  for (const entry of Object.values(cache.goalsById)) {
    if (normalizeKey(entry.title) === normalized) {
      return entry.goalId;
    }
  }
  return undefined;
}

export function findDesireIdByTitle(cache: SessionEntityCache, title: string): string | undefined {
  const normalized = normalizeKey(title);
  if (!normalized) return undefined;
  for (const entry of Object.values(cache.desiresById)) {
    if (normalizeKey(entry.title) === normalized) {
      return entry.desireId;
    }
  }
  return undefined;
}

export function findDesireByTitle(cache: SessionEntityCache, title: string): DesireCacheEntry | undefined {
  const normalized = normalizeKey(title);
  if (!normalized) return undefined;
  for (const entry of Object.values(cache.desiresById)) {
    if (normalizeKey(entry.title) === normalized) {
      return entry;
    }
  }
  return undefined;
}
