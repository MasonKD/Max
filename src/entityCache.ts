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
  cache.desiresById[entry.desireId] = {
    desireId: entry.desireId,
    title: entry.title ?? existing?.title,
    category: entry.category ?? existing?.category,
    lastSeenAt: new Date().toISOString()
  };
}

export function findGoalIdByTitle(cache: SessionEntityCache, title: string): string | undefined {
  const normalized = title.trim().toLowerCase();
  for (const entry of Object.values(cache.goalsById)) {
    if (entry.title?.trim().toLowerCase() === normalized) {
      return entry.goalId;
    }
  }
  return undefined;
}

export function findDesireIdByTitle(cache: SessionEntityCache, title: string): string | undefined {
  const normalized = title.trim().toLowerCase();
  for (const entry of Object.values(cache.desiresById)) {
    if (entry.title?.trim().toLowerCase() === normalized) {
      return entry.desireId;
    }
  }
  return undefined;
}
