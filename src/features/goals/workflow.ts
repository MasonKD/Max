import type { BrowserContext, Locator, Page } from "playwright";
import type { AuthState, GoalStatusBlock, GoalStatusDetail, GoalSummary, TaskItem } from "../../core/types.js";
import type { SearchRoot } from "../../platform/navigation.js";
import { config } from "../../core/config.js";
import { extractGoalsOverview, extractGoalSummariesFromText, dedupeGoalSummaries } from "../../platform/extractors.js";
import { readTaskPanelSnapshotDiagnostic, readBodySnippet } from "../../platform/diagnostics.js";
import { goalIdFromUrl, normalizeDateInput, titleCase } from "../../platform/navigation.js";
import { selectors, textSelectors } from "../../platform/selectors.js";
import { StateError } from "../../core/recovery.js";
import { knownRoutes, type KnownRouteId } from "../../platform/catalog.js";
import type { GoalCacheEntry } from "../../client/entityCache.js";

export type GoalsWorkflowDeps = {
  ensurePage: () => Page;
  pageOrThrow: () => Page;
  context: () => BrowserContext | undefined;
  ensureOnGoals: () => Promise<void>;
  tryClickByText: (root: SearchRoot, texts: string[], scope?: Locator) => Promise<boolean>;
  clickByText: (root: SearchRoot, texts: string[], scope?: Locator) => Promise<void>;
  resolveGoalTitleInput: (scope?: SearchRoot) => Promise<Locator>;
  resolveCreateGoalPanel: () => Promise<Locator | null>;
  selectCreateGoalCategory: (category: string) => Promise<boolean>;
  readGoalCount: (label: "Active" | "Complete" | "Archived" | "All") => Promise<number | null>;
  readAuthState: () => Promise<AuthState>;
  openGoalForRead: (goalTitle?: string, goalId?: string) => Promise<void>;
  openGoalContext: (goalTitle: string) => Promise<void>;
  openGoalContextById: (goalId: string) => Promise<void>;
  waitForGoalContext: (goalTitle?: string, timeoutMs?: number) => Promise<boolean>;
  waitForGoalDataLoaded: (timeoutMs?: number, page?: Page) => Promise<void>;
  isGoalWorkspaceVisible: () => Promise<boolean>;
  captureCurrentGoalWorkspace: () => Promise<{
    title?: string;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
    statusBlocks: GoalStatusBlock[];
    tabs: string[];
    messages: string[];
    snippet: string;
  }>;
  readBodySnippet: () => Promise<string>;
  cacheGoal: (entry: {
    goalId: string;
    title?: string;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
    taskPanelState?: "tasks_present" | "add_tasks" | "empty";
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
  }) => void;
  findGoalIdByTitle: (title: string) => string | undefined;
  listGoalIdsFromPage: () => Promise<string[]>;
  tryOpenAnyGoalByLink: () => Promise<boolean>;
  tryClickStartInGoalsList: () => Promise<boolean>;
  tryClickGoalCardAction: (goalTitle: string, actionTexts: string[]) => Promise<boolean>;
  resolveTaskInput: () => Promise<Locator>;
  resolveTaskRow: (taskText: string) => Promise<Locator>;
  resolveTaskRowWithinPanel: (taskText: string) => Promise<Locator | null>;
  readVisibleTaskItems: () => Promise<TaskItem[]>;
  waitForTaskToAppear: (taskText: string, timeoutMs?: number) => Promise<TaskItem | null>;
  waitForTaskState: (taskText: string, completed: boolean, timeoutMs?: number) => Promise<TaskItem | null>;
  waitForTaskToDisappear: (taskText: string, timeoutMs?: number) => Promise<boolean>;
  ensureOnGoalTaskContext: (goalTitle?: string, goalId?: string) => Promise<void>;
  isTaskPanelVisible: () => Promise<boolean>;
  resolveTaskPanel: () => Promise<Locator | null>;
  openTaskPanel: () => Promise<void>;
  withTemporaryPage: <T>(fn: (page: Page) => Promise<T>) => Promise<T>;
  getGoalTaskSummary: (goalTitle?: string, goalId?: string) => Promise<{
    goalId?: string;
    title: string;
    taskPanelState: "tasks_present" | "add_tasks" | "empty";
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
  } | null>;
  resolveGoalCard: (goalTitle: string) => Promise<Locator | null>;
  resolveTaskRowInGoalCard: (goalTitle: string, taskText: string) => Promise<Locator | null>;
  readGoalCardTaskCompletion: (goalTitle: string) => Promise<{ completed: number; total: number } | null>;
  waitForGoalCardTaskCompletionDelta: (goalTitle: string, previousCompleted: number, delta: number, timeoutMs?: number) => Promise<boolean>;
  clickGoalCardTaskToggle: (goalTitle: string, taskText: string) => Promise<boolean>;
  clickGoalCardTaskRemove: (goalTitle: string, taskText: string) => Promise<boolean>;
  entityGoals: () => Record<string, GoalCacheEntry>;
  isGoalContextOpen: (goalTitle?: string) => Promise<boolean>;
  tryPromoteDesireToGoal: (desireTitle: string) => Promise<boolean>;
  updateGoalDueDateFromGoals: (goalTitle: string, dueDateInput: string) => Promise<boolean>;
  formatGoalDueLabel: (input: string) => string | null;
  waitForGoalDueLabel: (goalTitle: string, expectedLabel: string, timeoutMs?: number) => Promise<boolean>;
  openGoalEditPanel: () => Promise<Locator | null>;
  clickGoalStatusAction: (status: "active" | "completed" | "archived") => Promise<boolean>;
};

export function createGoalsWorkflow(deps: GoalsWorkflowDeps) {
  function normalizeKey(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
  }

  function assertUniqueNormalized(values: string[], label: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = normalizeKey(value);
      if (!normalized) continue;
      if (seen.has(normalized)) throw new Error(`${label} must be unique: "${value}"`);
      seen.add(normalized);
    }
  }

  async function assertGoalTitleAvailable(title: string): Promise<void> {
    const normalized = normalizeKey(title);
    if (!normalized) return;
    const cachedDuplicate = Object.values(deps.entityGoals()).find((goal) => normalizeKey(goal.title) === normalized);
    if (cachedDuplicate) {
      throw new Error(`goal title must be unique: "${title}" already exists`);
    }
    for (const filter of ["active", "complete", "archived", "all"] as const) {
      const listed = await createGoalsWorkflowInstance.listGoals(filter).catch(() => null);
      const duplicate = listed?.goals?.find((goal) => normalizeKey(goal.title) === normalized);
      if (duplicate) {
        throw new Error(`goal title must be unique: "${title}" already exists`);
      }
    }
  }

  async function resolveGoalIdentity(goalTitle?: string, goalId?: string): Promise<{ goalId: string; goalTitle?: string }> {
    let resolvedGoalId = goalId;
    let resolvedGoalTitle = goalTitle;
    if (resolvedGoalId) {
      await deps.openGoalContextById(resolvedGoalId);
    } else if (resolvedGoalTitle) {
      await deps.openGoalContext(resolvedGoalTitle);
      resolvedGoalId = goalIdFromUrl(deps.pageOrThrow().url()) ?? deps.findGoalIdByTitle(resolvedGoalTitle);
    }
    if (!resolvedGoalId) {
      throw new Error(`could not resolve goal id for ${resolvedGoalTitle ?? "unknown goal"}`);
    }
    if (!resolvedGoalTitle) {
      const snapshot = await deps.captureCurrentGoalWorkspace().catch(() => null);
      resolvedGoalTitle = snapshot?.title;
    }
    return { goalId: resolvedGoalId, goalTitle: resolvedGoalTitle };
  }

  async function waitForGoalStatusChange(
    nextStatus: "active" | "completed" | "archived",
    goalTitle: string | undefined,
    before: { active: number | null; complete: number | null; archived: number | null },
    timeoutMs = 4000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await deps.ensureOnGoals();
      const [activeAfter, completeAfter, archivedAfter] = await Promise.all([
        deps.readGoalCount("Active"),
        deps.readGoalCount("Complete"),
        deps.readGoalCount("Archived")
      ]);
      const activeGoals = await createGoalsWorkflowInstance.listGoals("active");
      const activeHasGoal = goalTitle ? activeGoals.goals.some((goal) => goal.title === goalTitle) : undefined;

      if (nextStatus === "completed") {
        if ((before.complete !== null && completeAfter !== null && completeAfter > before.complete) || activeHasGoal === false) return true;
      }
      if (nextStatus === "archived") {
        if ((before.archived !== null && archivedAfter !== null && archivedAfter > before.archived) || activeHasGoal === false) return true;
      }
      if (nextStatus === "active") {
        if (
          (before.active !== null && activeAfter !== null && activeAfter > before.active) ||
          activeHasGoal === true ||
          (before.complete !== null && completeAfter !== null && completeAfter < before.complete) ||
          (before.archived !== null && archivedAfter !== null && archivedAfter < before.archived)
        ) return true;
      }

      await deps.pageOrThrow().waitForTimeout(250);
    }
    return false;
  }

  const createGoalsWorkflowInstance = {
    async readGoalsOverview() {
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();
      const auth = await deps.readAuthState();
      const text = await page.locator("body").innerText().catch(() => "");
      const result = extractGoalsOverview(text);
      return { url: page.url(), auth, ...result };
    },

    async listGoals(filter: string): Promise<{ filter: string; auth: AuthState; goals: GoalSummary[] }> {
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();
      const auth = await deps.readAuthState();

      const normalized = filter.trim().toLowerCase();
      if (normalized === "active") {
        await deps.tryClickByText(page, ["Active"]);
      } else if (normalized === "complete") {
        await deps.tryClickByText(page, ["Complete"]);
      } else if (normalized === "archived") {
        await deps.tryClickByText(page, ["Archived"]);
      } else {
        await deps.tryClickByText(page, ["All"]);
      }

      const goals = await page.evaluate(() => {
        const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
        const linesOf = (value: string) => value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        const categories = new Set(["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"]);
        const goalScopeAnchor = Array.from(document.querySelectorAll("*"))
          .find((node) => normalize(node.textContent || "") === "YOUR GOALS");
        const scope = goalScopeAnchor?.parentElement?.parentElement ?? document.body;
        const candidates = Array.from(scope.querySelectorAll("article, section, li, div"))
          .filter((node) => {
            const text = normalize(node.textContent || "");
            return Boolean(text) && /^START$/im.test(node.textContent || "") && /Due\s+\d{2}\/\d{2}\/\d{2}/i.test(text);
          });

        const seen = new Set<string>();
        const extracted: GoalSummary[] = [];
        for (const row of candidates) {
          const text = normalize(row.textContent || "");
          if (!text) continue;
          const lines = linesOf(row.textContent || "");
          const categoryIndex = lines.findIndex((line) => categories.has(line));
          if (categoryIndex <= 0) continue;
          const title = lines[categoryIndex - 1];
          const category = lines[categoryIndex];
          const dueLabel = lines.find((line) => /^Due\s/i.test(line));
          if (!title || !category || !dueLabel || seen.has(title)) continue;
          seen.add(title);
          const progressLabel = lines.find((line) => /tasks completed|\d+%/i.test(line));
          const taskSummaryLabel = lines.find((line) => /tasks completed|No tasks/i.test(line));
          const hasExplicitAddTasks = lines.some((line) => /^ADD TASKS$/i.test(line));
          const taskPreviewItems = lines.filter((line, index) =>
            index > categoryIndex &&
            line !== dueLabel &&
            line !== progressLabel &&
            line !== taskSummaryLabel &&
            !/^(START|ADD TASKS|No tasks)$/i.test(line) &&
            !/^\d+%$/i.test(line)
          ).slice(0, 12);
          const idMatch =
            row.outerHTML.match(/goalId=([A-Za-z0-9_-]+)/i) ??
            row.outerHTML.match(/data-goal-id=["']?([A-Za-z0-9_-]+)/i);
          extracted.push({
            title,
            goalId: idMatch?.[1],
            category,
            dueLabel,
            progressLabel,
            taskSummaryLabel,
            taskPreviewItems,
            taskPanelState: taskSummaryLabel && /tasks completed/i.test(taskSummaryLabel)
              ? "tasks_present"
              : hasExplicitAddTasks
                ? "add_tasks"
                : "empty"
          });
        }

        return extracted;
      });

      const summaryGoals = extractGoalSummariesFromText(await page.locator("body").innerText().catch(() => ""));
      let extractedGoals = goals;
      if (summaryGoals.length > 0) {
        const merged = new Map<string, GoalSummary>();
        for (const item of goals) merged.set(item.title, item);
        for (const summary of summaryGoals) {
          const existing = merged.get(summary.title);
          merged.set(summary.title, { ...existing, ...summary, goalId: existing?.goalId });
        }
        extractedGoals = dedupeGoalSummaries([...merged.values()]);
      } else if (extractedGoals.length === 0) {
        extractedGoals = summaryGoals;
      }

      for (const goal of extractedGoals) {
        const resolvedGoalId = goal.goalId ?? deps.findGoalIdByTitle(goal.title);
        if (resolvedGoalId) {
          deps.cacheGoal({
            goalId: resolvedGoalId,
            title: goal.title,
            category: goal.category,
            dueLabel: goal.dueLabel,
            progressLabel: goal.progressLabel,
            taskPanelState: goal.taskPanelState,
            taskSummaryLabel: goal.taskSummaryLabel,
            taskPreviewItems: goal.taskPreviewItems
          });
        }
      }

      return { filter: normalized, auth, goals: extractedGoals };
    },

    async surveyActiveGoalTaskStates() {
      const listed = await this.listGoals("active");
      const goals = listed.goals.map((goal) => ({
        title: goal.title,
        goalId: goal.goalId,
        category: goal.category,
        progressLabel: goal.progressLabel,
        taskSummaryLabel: goal.taskSummaryLabel,
        taskPreviewItems: goal.taskPreviewItems,
        taskPanelState: goal.taskPanelState ?? "empty"
      }));
      const counts = { tasks_present: 0, add_tasks: 0, empty: 0 };
      for (const goal of goals) counts[goal.taskPanelState] += 1;
      return { goals, counts };
    },

    async discoverGoals(waitMs?: unknown) {
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();
      const dom = await page.evaluate(() => {
        const items: Array<{ goalId: string; title?: string }> = [];
        const seen = new Set<string>();
        const push = (goalId: string, title?: string): void => {
          if (!goalId || seen.has(goalId)) return;
          seen.add(goalId);
          items.push({ goalId, title: title?.trim() || undefined });
        };
        for (const link of Array.from(document.querySelectorAll("a[href]"))) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/goalId=([A-Za-z0-9_-]+)/i);
          if (!match?.[1]) continue;
          const card = link.closest("article,section,li,div");
          const text = (card?.textContent || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
          const title = text.find((line) => line.length > 2 && !/start|due|tasks completed|health|work|love|family|social|fun|dreams|meaning/i.test(line));
          push(match[1], title);
        }
        for (const el of Array.from(document.querySelectorAll("[data-goal-id], [data-goalid], [goalid]"))) {
          const value = el.getAttribute("data-goal-id") ?? el.getAttribute("data-goalid") ?? el.getAttribute("goalid") ?? "";
          if (/^[A-Za-z0-9_-]{8,}$/.test(value)) push(value);
        }
        return items;
      });

      const merged = new Map<string, { goalId: string; title?: string }>();
      for (const item of dom) merged.set(item.goalId, item);

      if (merged.size === 0) {
        const listed = await this.listGoals("active");
        for (const goal of listed.goals) {
          try {
            await deps.openGoalContext(goal.title);
            const resolvedId = goalIdFromUrl(deps.pageOrThrow().url());
            if (resolvedId) {
              merged.set(resolvedId, { goalId: resolvedId, title: goal.title });
              deps.cacheGoal({ goalId: resolvedId, title: goal.title, category: goal.category, dueLabel: goal.dueLabel, progressLabel: goal.progressLabel });
            }
          } catch {
          }
        }
        await deps.ensureOnGoals();
      }

      return {
        goals: [...merged.values()],
        sources: { domGoalIds: dom.length, streamGoalIds: 0 },
        waitMs: typeof waitMs === "number" && Number.isFinite(waitMs) ? waitMs : 0,
        loadingVisible: false
      };
    },

    async readGoal(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const workspaceVisible = await deps.isGoalWorkspaceVisible();
      const snapshot = await deps.captureCurrentGoalWorkspace();
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
      const resolvedGoalTitle = goalTitle ?? snapshot.title;
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: resolvedGoalTitle });
      return { goalId: resolvedGoalId, goalTitle: resolvedGoalTitle, url: page.url(), workspaceVisible, snippet: snapshot.snippet, statusBlocks: snapshot.statusBlocks };
    },

    async readGoalMetadata(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const result = await deps.captureCurrentGoalWorkspace();
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
      const resolvedGoalTitle = goalTitle ?? result.title;
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: resolvedGoalTitle, category: result.category, dueLabel: result.dueLabel, progressLabel: result.progressLabel });
      return { goalId: resolvedGoalId, goalTitle: resolvedGoalTitle, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), category: result.category, dueLabel: result.dueLabel, progressLabel: result.progressLabel, snippet: result.snippet };
    },

    async readGoalFull(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const snapshot = await deps.captureCurrentGoalWorkspace();
      const tasks = await this.listGoalTasks(goalTitle ?? snapshot.title, goalId ?? goalIdFromUrl(page.url()));
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url()) ?? tasks.goalId;
      const resolvedGoalTitle = goalTitle ?? snapshot.title ?? tasks.goalTitle;
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: resolvedGoalTitle, category: snapshot.category, dueLabel: snapshot.dueLabel, progressLabel: snapshot.progressLabel });
      return { goalId: resolvedGoalId, goalTitle: resolvedGoalTitle, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), category: snapshot.category, dueLabel: snapshot.dueLabel, progressLabel: snapshot.progressLabel, statusBlocks: snapshot.statusBlocks, messages: snapshot.messages, tasks: tasks.tasks, taskReadReason: tasks.reason, snippet: snapshot.snippet };
    },

    async readGoalStatusDetails(goalTitle?: string, goalId?: string): Promise<{ goalId?: string; goalTitle?: string; url: string; details: GoalStatusDetail[] }> {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      if (!(await deps.isGoalWorkspaceVisible())) {
        throw new Error(`goal workspace not visible while reading status details: ${page.url()}`);
      }
      const snapshot = await deps.captureCurrentGoalWorkspace();
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url()) ?? undefined;
      const resolvedGoalTitle = goalTitle ?? snapshot.title;
      const fieldKeyByName: Record<string, string> = {
        DESIRE: "desire",
        ENVIRONMENT: "environment",
        MENTALITY: "mentality",
        ACTIONS: "appearanceAndBehaviour",
        SITUATION: "situation",
        FEEDBACK: "feedback"
      };
      const details: GoalStatusDetail[] = snapshot.statusBlocks.map((block) => {
        const key = fieldKeyByName[block.name] ?? block.name.toLowerCase();
        const summary = undefined;
        const updatedAt = null;
        const hasNotUpdatedPrompt = block.prompts.some((prompt) => /not yet updated/i.test(prompt));
        const checked = !hasNotUpdatedPrompt && !/^○$/u.test(block.state.trim());
        return {
          name: block.name,
          key,
          checked,
          state: block.state,
          prompts: block.prompts,
          summary,
          updatedAt,
          tooltip: updatedAt ?? (checked ? "Updated" : "Not yet updated")
        };
      });
      return { goalId: resolvedGoalId, goalTitle: resolvedGoalTitle, url: page.url(), details };
    },

    async readCachedGoals() {
      return { goals: Object.values(deps.entityGoals()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)) };
    },

    async readTaskPanelSnapshot(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      await deps.openTaskPanel();
      const panel = await deps.resolveTaskPanel();
      const taskPanelVisible = Boolean(panel && (await panel.count()) > 0);
      const result = await readTaskPanelSnapshotDiagnostic(page, panel ? ((await panel.innerText().catch(() => "")).replace(/\s+/g, " ").trim() || undefined) : undefined, taskPanelVisible);
      return { goalId: goalId ?? goalIdFromUrl(page.url()), goalTitle, ...result };
    },

    async readGoalWorkspace(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const result = await deps.captureCurrentGoalWorkspace();
      return { goalId: goalId ?? goalIdFromUrl(page.url()), goalTitle: goalTitle ?? result.title, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), tabs: result.tabs, currentGoal: result.title, snippet: result.snippet };
    },

    async listGoalTasks(goalTitle?: string, goalId?: string): Promise<{ goalId?: string; goalTitle?: string; url: string; workspaceVisible: boolean; reason?: string; snippet?: string; tasks: TaskItem[] }> {
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState === "add_tasks") {
        return { goalId: goalId ?? summary.goalId, goalTitle: goalTitle ?? summary.title, url: deps.pageOrThrow().url(), workspaceVisible: false, reason: summary.taskSummaryLabel ?? "No tasks", snippet: await deps.readBodySnippet().catch(() => ""), tasks: [] };
      }
      if (summary?.taskPanelState === "tasks_present" && (summary.taskPreviewItems?.length ?? 0) > 0) {
        return { goalId: goalId ?? summary.goalId, goalTitle: goalTitle ?? summary.title, url: deps.pageOrThrow().url(), workspaceVisible: false, reason: summary.taskSummaryLabel, snippet: await deps.readBodySnippet().catch(() => ""), tasks: summary.taskPreviewItems!.map((text) => ({ text, completed: false })) };
      }

      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      try {
        await deps.ensureOnGoalTaskContext(undefined, goalId);
      } catch (error) {
        return { goalId: goalId ?? goalIdFromUrl(page.url()), goalTitle, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), reason: error instanceof Error ? error.message : String(error), snippet: await deps.readBodySnippet(), tasks: [] };
      }
      const taskPanelVisible = await deps.isTaskPanelVisible();
      if (!taskPanelVisible) {
        return { goalId: goalId ?? goalIdFromUrl(page.url()), goalTitle, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), reason: "task panel content not visible", snippet: await deps.readBodySnippet(), tasks: [] };
      }
      const tasks = await deps.readVisibleTaskItems();

      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
      return { goalId: resolvedGoalId, goalTitle, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), reason: tasks.length === 0 ? "no visible tasks extracted" : undefined, snippet: await deps.readBodySnippet(), tasks };
    },

    async readTaskSuggestions(goalTitle?: string, goalId?: string): Promise<{ goalId?: string; goalTitle?: string; url: string; suggestions: string[] }> {
      await deps.ensureOnGoalTaskContext(goalTitle, goalId);
      const page = deps.pageOrThrow();
      await deps.clickByText(page, ["Use the task suggestion tool", "Select Tasks"]);
      const dialog = page.locator('[role="dialog"]').first();
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const text = await dialog.innerText().catch(() => "");
        if (text && !/Generating tasks\.\.\./i.test(text)) break;
        await page.waitForTimeout(250);
      }
      const text = await dialog.innerText().catch(() => page.locator("body").innerText().catch(() => ""));
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const start = lines.findIndex((line) => /^Select Tasks$/i.test(line) || /^How will you accomplish:/i.test(line));
      const end = lines.findIndex((line, index) => index > start && /^(Cancel|Set Tasks|Close)$/i.test(line));
      const suggestions = (start === -1 ? lines : lines.slice(start + 1, end === -1 ? undefined : end))
        .filter((line) => !/Select the tasks you want to add:|Tasks are generated based on your personality|Cancel|Set Tasks|Close|Generating tasks/i.test(line))
        .filter((line) => !/^How will you accomplish:/i.test(line))
        .filter((line) => line.length > 3);
      return {
        goalId: goalId ?? goalIdFromUrl(page.url()) ?? undefined,
        goalTitle,
        url: page.url(),
        suggestions: [...new Set(suggestions)]
      };
    },

    async readGoalChat(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
      const snapshot = await deps.captureCurrentGoalWorkspace();
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
      return { goalId: resolvedGoalId, goalTitle, url: page.url(), messages: snapshot.messages };
    },

    async createGoal(input: { title: string; category: string; dueDate: string }) {
      const page = deps.ensurePage();
      if (!input.title.trim()) throw new Error("create_goal requires title");
      if (!input.category?.trim()) throw new Error("create_goal requires category");
      if (!input.dueDate?.trim()) throw new Error("create_goal requires dueDate");
      await assertGoalTitleAvailable(input.title);
      await deps.ensureOnGoals();
      const activeBefore = await deps.readGoalCount("Active");
      const opened = await deps.tryClickByText(page, ["NEW GOAL", "(I KNOW WHAT MY GOAL IS)", "I KNOW WHAT MY GOAL IS", "Create a New Goal"]);
      if (!opened) {
        const fallback = page.getByText(/I KNOW WHAT MY GOAL IS/i).first();
        if ((await fallback.count()) > 0) {
          await fallback.scrollIntoViewIfNeeded().catch(() => undefined);
          await fallback.click({ timeout: 2000 });
        } else {
          throw new Error("could not open create-goal flow");
        }
      }
      await page.waitForTimeout(200);
      const form = await deps.resolveCreateGoalPanel();
      const titleField = await deps.resolveGoalTitleInput(form ?? undefined);
      await titleField.fill(input.title);
      const categorySet = await deps.selectCreateGoalCategory(input.category);
      if (!categorySet) throw new Error(`could not select create_goal category: ${input.category}`);
      const due = (form ?? page).locator('input[type="date"]').first();
      if ((await due.count()) > 0) {
        const normalized = normalizeDateInput(input.dueDate);
        if (!normalized) throw new Error(`invalid create_goal dueDate: ${input.dueDate}`);
        await due.fill(normalized);
      } else {
        throw new Error("could not locate create_goal due date input");
      }
      let submitted = false;
      const createResponsePromise = page.waitForResponse((res) => res.request().method() === "POST" && /\/goals(\?|$)/.test(res.url()), { timeout: 10000 }).catch(() => null);
      const createBtn = page.getByRole("button", { name: /^create goal$/i }).first();
      if ((await createBtn.count()) > 0 && (await createBtn.isVisible().catch(() => false))) {
        try {
          await createBtn.click({ timeout: 2000 });
          submitted = true;
        } catch {
          submitted = false;
        }
      }
      if (!submitted) submitted = await deps.tryClickByText(form ?? page, ["Create Goal", "Create", "Save", "Add Goal", "Done"]);
      if (!submitted) {
        const domClicked = await page.evaluate(() => {
          const button = Array.from(document.querySelectorAll("button")).find((el) => (el.textContent || "").trim().toLowerCase() === "create goal") as HTMLButtonElement | undefined;
          if (!button) return false;
          button.click();
          return true;
        });
        submitted = domClicked;
      }
      if (!submitted) await titleField.press("Enter");
      const deadline = Date.now() + 4000;
      let serverError: string | null = null;
      const createResponse = await createResponsePromise;
      if (createResponse) {
        try {
          const raw = await createResponse.text();
          const match = raw.match(/"success":false,"error":"([^"]+)"/);
          if (match?.[1]) serverError = match[1];
        } catch {
          serverError = null;
        }
      }
      while (Date.now() < deadline) {
        if (await deps.isGoalContextOpen(input.title)) return { created: true, title: input.title };
        await deps.ensureOnGoals();
        const activeAfter = await deps.readGoalCount("Active");
        if (activeBefore !== null && activeAfter !== null && activeAfter > activeBefore) {
          const activeGoals = await createGoalsWorkflowInstance.listGoals("active").catch(() => null);
          if (activeGoals?.goals?.some((goal) => goal.title === input.title)) {
            return { created: true, title: input.title };
          }
        }
        const listed = await createGoalsWorkflowInstance.listGoals("active").catch(() => null);
        if (listed?.goals?.some((goal) => goal.title === input.title)) return { created: true, title: input.title };
        await page.waitForTimeout(300);
      }
      const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      if (serverError) throw new Error(`create_goal failed: ${serverError}`);
      throw new Error(`create_goal submission did not increase active goal count (before=${activeBefore} title=${input.title} snippet=${snippet})`);
    },

    async createGoalsFromDesires(rawDesires: unknown[]) {
      const desires = rawDesires.map((entry) => {
        if (typeof entry === "string") return { title: entry, category: undefined, dueDate: undefined };
        if (typeof entry === "object" && entry !== null) {
          const obj = entry as Record<string, unknown>;
          const sourceTitle =
            typeof obj.title === "string" ? obj.title :
            typeof obj.desireTitle === "string" ? obj.desireTitle :
            "";
          const sourceCategory =
            typeof obj.category === "string" ? obj.category :
            typeof obj.desireCategory === "string" ? obj.desireCategory :
            typeof obj.bucket === "string" ? obj.bucket :
            undefined;
          const overrideTitle =
            typeof obj.goalTitle === "string" ? obj.goalTitle :
            typeof obj.overrideTitle === "string" ? obj.overrideTitle :
            undefined;
          const overrideCategory =
            typeof obj.goalCategory === "string" ? obj.goalCategory :
            typeof obj.overrideCategory === "string" ? obj.overrideCategory :
            undefined;
          return {
            title: String(overrideTitle ?? sourceTitle ?? ""),
            category: typeof (overrideCategory ?? sourceCategory) === "string" ? String(overrideCategory ?? sourceCategory) : undefined,
            dueDate: typeof obj.dueDate === "string" ? obj.dueDate : undefined
          };
        }
        return { title: "", category: undefined, dueDate: undefined };
      }).filter((entry) => entry.title.trim().length > 0);
      assertUniqueNormalized(desires.map((entry) => entry.title), "desire titles");
      assertUniqueNormalized(desires.map((entry) => entry.title), "resulting goal titles");
      const created: string[] = [];
      for (const desire of desires) {
        if (!desire.category?.trim()) throw new Error(`create_goals_from_desires requires category for "${desire.title}"`);
        if (!desire.dueDate?.trim()) throw new Error(`create_goals_from_desires requires dueDate for "${desire.title}"`);
        await this.createGoal({ title: desire.title, category: desire.category, dueDate: desire.dueDate });
        created.push(desire.title);
      }
      return { created };
    },

    async updateGoalDueDate(goalTitle?: string, goalId?: string, dueDateInput?: string) {
      if (!dueDateInput?.trim()) throw new Error("update_goal_due_date requires dueDate");
      const normalizedDate = normalizeDateInput(dueDateInput);
      if (!normalizedDate) throw new Error(`invalid dueDate: ${dueDateInput}`);
      const expectedLabel = deps.formatGoalDueLabel(normalizedDate);
      const { goalId: resolvedGoalId, goalTitle: resolvedGoalTitle } = await resolveGoalIdentity(goalTitle, goalId);
      let updated = false;
      if (resolvedGoalTitle) updated = await deps.updateGoalDueDateFromGoals(resolvedGoalTitle, normalizedDate).catch(() => false);
      if (!updated) {
        throw new Error(`could not update due date for ${resolvedGoalTitle ?? resolvedGoalId}`);
      }
      if (resolvedGoalTitle && expectedLabel) {
        const labelMatches = await deps.waitForGoalDueLabel(resolvedGoalTitle, expectedLabel, 3000).catch(() => false);
        if (!labelMatches) throw new Error(`update_goal_due_date postcondition failed for ${resolvedGoalTitle}`);
      }
      return { updated: true, goalId: resolvedGoalId, goalTitle: resolvedGoalTitle, dueDate: normalizedDate };
    },

    async updateGoal(goalTitle: string, updates: { status?: "active" | "completed" | "archived"; dueDate?: string }) {
      if (!goalTitle.trim()) throw new Error("update_goal requires goalTitle");
      if (!updates.status && !updates.dueDate) throw new Error("update_goal requires status or dueDate");
      const applied: Record<string, unknown> = { goalTitle };
      if (updates.dueDate) {
        const due = await this.updateGoalDueDate(goalTitle, undefined, updates.dueDate);
        applied.dueDate = due.dueDate;
      }
      if (updates.status === "completed") {
        await this.completeGoal(goalTitle, undefined);
        applied.status = "completed";
      } else if (updates.status === "archived") {
        await this.archiveGoal(goalTitle, undefined);
        applied.status = "archived";
      } else if (updates.status === "active") {
        await this.reactivateGoal(goalTitle, undefined);
        applied.status = "active";
      }
      return applied;
    },

    async startGoal(goalTitle?: string, goalId?: string): Promise<{ started: boolean; goalTitle?: string; goalId?: string }> {
      if (await deps.isGoalContextOpen(goalTitle)) return { started: true, goalTitle, goalId };
      const page = deps.pageOrThrow();
      if (goalId) {
        await deps.openGoalContextById(goalId);
        if (await deps.waitForGoalContext(goalTitle, 2500)) return { started: true, goalTitle, goalId };
        throw new Error(`could not open goal context for goalId: ${goalId}`);
      }
      await deps.ensureOnGoals();
      if (!goalTitle) {
        const discoveredIds = await deps.listGoalIdsFromPage();
        if (discoveredIds.length > 0) {
          await deps.openGoalContextById(discoveredIds[0]);
          if (await deps.waitForGoalContext(undefined, 2500)) return { started: true, goalId: discoveredIds[0] };
        }
        let clicked = (await deps.tryOpenAnyGoalByLink()) || (await deps.tryClickStartInGoalsList()) || (await deps.tryClickByText(page, ["START", "Start", "Open", "View"]));
        if (!clicked) {
          await deps.tryClickByText(page, ["All"]);
          await deps.tryClickByText(page, ["All"]);
          clicked = (await deps.tryOpenAnyGoalByLink()) || (await deps.tryClickStartInGoalsList()) || (await deps.tryClickByText(page, ["START", "Start", "Open", "View"]));
        }
        if (!clicked) throw new Error("could not locate any start action");
        const opened = await deps.waitForGoalContext(undefined, 2500);
        if (!opened) throw new Error("start action did not open goal context");
        return { started: true, goalId: goalIdFromUrl(deps.pageOrThrow().url()) };
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const clicked = await deps.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
        if (!clicked) {
          await deps.tryClickByText(page, ["All"]);
          const clickedAfterReset = await deps.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
          if (!clickedAfterReset) await deps.tryOpenAnyGoalByLink();
        }
        if (await deps.waitForGoalContext(goalTitle, 2000)) return { started: true, goalTitle, goalId: goalIdFromUrl(deps.pageOrThrow().url()) };
        const byIds = await deps.listGoalIdsFromPage();
        for (const id of byIds) {
          await deps.openGoalContextById(id);
          if (await deps.waitForGoalContext(goalTitle, 1500)) return { started: true, goalTitle, goalId: id };
        }
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
      throw new Error(`could not execute goal action START/Start/Open/View for goal: ${goalTitle}`);
    },

    async addTasks(goalTitle: string | undefined, goalId: string | undefined, tasks: string[], useSuggestions: boolean) {
      const requestedTasks = tasks.map((task) => task.trim()).filter((task) => task.length > 0);
      assertUniqueNormalized(requestedTasks, "task titles within a goal");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState === "empty") throw new Error(`add_tasks refused: goal has no task entry point from /goals summary (${summary.title})`);
      await deps.ensureOnGoalTaskContext(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url()) ?? summary?.goalId;
      const existingTasks = await deps.readVisibleTaskItems().catch(() => [] as TaskItem[]);
      const existingTaskKeys = new Set(existingTasks.map((task) => normalizeKey(task.text)).filter(Boolean));
      for (const task of requestedTasks) {
        if (existingTaskKeys.has(normalizeKey(task))) {
          throw new Error(`task title must be unique within goal: "${task}" already exists`);
        }
      }
      if (useSuggestions) {
        await deps.clickByText(page, ["Use the task suggestion tool", "Select Tasks"]);
        for (const task of requestedTasks) await deps.tryClickByText(page, [task]);
        await deps.tryClickByText(page, ["Set Tasks", "Add", "Save"]);
        return { added: requestedTasks.length, goalTitle, usedSuggestions: true, taskTexts: requestedTasks };
      }
      let added = 0;
      const addedTaskTexts: string[] = [];
      if (summary?.taskPanelState === "add_tasks") await deps.tryClickByText(page, ["ADD TASKS", "Add Tasks", "Use the task suggestion tool"]);
      for (const task of requestedTasks) {
        await deps.tryClickByText(page, ["Add new task", "Add task", "New task"]);
        const field = await deps.resolveTaskInput();
        await field.fill(task);
        await field.press("Enter");
        const observed = await deps.waitForTaskToAppear(task, 3000);
        addedTaskTexts.push(observed?.text ?? task);
        added += 1;
      }
      return { added, goalTitle, usedSuggestions: false, taskTexts: addedTaskTexts };
    },

    async removeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("remove_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState !== "tasks_present") throw new Error(`remove_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
      const resolvedGoalTitle = goalTitle ?? summary.title;
      let resolvedGoalId = goalId ?? summary.goalId;
      await deps.ensureOnGoals();
      let removed = await deps.clickGoalCardTaskRemove(resolvedGoalTitle, taskText);
      if (!removed) {
        try {
          await deps.ensureOnGoalTaskContext(resolvedGoalTitle, goalId);
          const row = await deps.resolveTaskRow(taskText);
          removed = (await deps.tryClickByText(deps.pageOrThrow(), ["Delete", "Remove", "Trash"], row)) || (await deps.tryClickByText(deps.pageOrThrow(), ["×"], row));
        } catch {
          removed = false;
        }
      }
      if (!removed && !resolvedGoalId) {
        try {
          await deps.openGoalContext(resolvedGoalTitle);
          resolvedGoalId = goalIdFromUrl(deps.pageOrThrow().url()) ?? undefined;
          await deps.ensureOnGoals();
        } catch {
          resolvedGoalId = undefined;
        }
      }
      if (!removed) throw new Error(`could not remove task: ${taskText}`);
      await deps.ensureOnGoals();
      const gone = await deps.waitForTaskToDisappear(taskText, 2500);
      if (!gone) throw new Error(`remove_task did not remove task: ${taskText}`);
      return { removed: true };
    },

    async completeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("complete_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState !== "tasks_present") throw new Error(`complete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
      const resolvedGoalTitle = goalTitle ?? summary.title;
      await deps.ensureOnGoals();
      const counts = await deps.readGoalCardTaskCompletion(resolvedGoalTitle);
      const toggled = await deps.clickGoalCardTaskToggle(resolvedGoalTitle, taskText);
      if (!toggled) throw new Error(`could not complete task: ${taskText}`);
      if (counts) {
        const advanced = await deps.waitForGoalCardTaskCompletionDelta(resolvedGoalTitle, counts.completed, 1, 3000);
        if (!advanced) throw new Error(`complete_task postcondition failed: ${taskText}`);
      }
      return { completed: true, taskText };
    },

    async uncompleteTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("uncomplete_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState !== "tasks_present") throw new Error(`uncomplete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
      const resolvedGoalTitle = goalTitle ?? summary.title;
      await deps.ensureOnGoals();
      const counts = await deps.readGoalCardTaskCompletion(resolvedGoalTitle);
      const toggled = await deps.clickGoalCardTaskToggle(resolvedGoalTitle, taskText);
      if (!toggled) throw new Error(`could not uncomplete task: ${taskText}`);
      if (counts) {
        const regressed = await deps.waitForGoalCardTaskCompletionDelta(resolvedGoalTitle, counts.completed, -1, 3000);
        if (!regressed) throw new Error(`uncomplete_task postcondition failed: ${taskText}`);
      }
      return { uncompleted: true, taskText };
    },

    async completeGoal(goalTitle?: string, goalId?: string) {
      await deps.ensureOnGoals();
      const before = {
        active: await deps.readGoalCount("Active"),
        complete: await deps.readGoalCount("Complete"),
        archived: await deps.readGoalCount("Archived")
      };
      const resolved = await resolveGoalIdentity(goalTitle, goalId);
      const opened = await deps.openGoalEditPanel();
      const done = Boolean(opened) && await deps.clickGoalStatusAction("completed");
      if (!done) throw new Error("could not complete goal");
      const transitioned = await waitForGoalStatusChange("completed", resolved.goalTitle, before);
      if (!transitioned) throw new Error("complete_goal postcondition failed");
      return { completed: true, goalTitle: resolved.goalTitle, goalId: resolved.goalId };
    },

    async archiveGoal(goalTitle?: string, goalId?: string) {
      await deps.ensureOnGoals();
      const before = {
        active: await deps.readGoalCount("Active"),
        complete: await deps.readGoalCount("Complete"),
        archived: await deps.readGoalCount("Archived")
      };
      const resolved = await resolveGoalIdentity(goalTitle, goalId);
      const opened = await deps.openGoalEditPanel();
      const done = Boolean(opened) && await deps.clickGoalStatusAction("archived");
      if (!done) throw new Error("could not archive goal");
      const transitioned = await waitForGoalStatusChange("archived", resolved.goalTitle, before);
      if (!transitioned) throw new Error("archive_goal postcondition failed");
      return { archived: true, goalTitle: resolved.goalTitle, goalId: resolved.goalId };
    },

    async reactivateGoal(goalTitle?: string, goalId?: string) {
      await deps.ensureOnGoals();
      const before = {
        active: await deps.readGoalCount("Active"),
        complete: await deps.readGoalCount("Complete"),
        archived: await deps.readGoalCount("Archived")
      };
      const resolved = await resolveGoalIdentity(goalTitle, goalId);
      const opened = await deps.openGoalEditPanel();
      const done = Boolean(opened) && await deps.clickGoalStatusAction("active");
      if (!done) throw new Error("could not reactivate goal");
      const transitioned = await waitForGoalStatusChange("active", resolved.goalTitle, before);
      if (!transitioned) throw new Error("reactivate_goal postcondition failed");
      return { reactivated: true, goalTitle: resolved.goalTitle, goalId: resolved.goalId };
    },

    async deleteGoal(goalTitle?: string, goalId?: string) {
      await deps.ensureOnGoals();
      const page = deps.pageOrThrow();
      if (goalId) {
        await deps.openGoalContextById(goalId);
      } else if (goalTitle) {
        const clicked = await deps.tryClickGoalCardAction(goalTitle, ["DELETE", "Delete", "Remove"]);
        if (clicked) {
          await deps.tryClickByText(page, ["Delete", "Confirm", "Yes", "YES"]);
          return { deleted: true, goalTitle, goalId };
        }
        await deps.openGoalContext(goalTitle);
      } else if (!page.url().includes("/self-maximize")) {
        await this.startGoal();
      }
      await deps.tryClickByText(page, ["EDIT", "Edit"]);
      const deleted = await deps.tryClickByText(page, ["DELETE GOAL", "Delete Goal", "DELETE", "Delete", "Remove"]);
      if (!deleted) throw new Error("could not locate delete action for goal");
      await deps.tryClickByText(page, ["Delete", "Confirm", "Yes", "YES"]);
      return { deleted: true, goalTitle, goalId: goalId ?? goalIdFromUrl(page.url()) };
    },

  };

  return createGoalsWorkflowInstance;
}
