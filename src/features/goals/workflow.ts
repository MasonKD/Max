import type { BrowserContext, Locator, Page } from "playwright";
import type { AuthState, GoalStatusBlock, GoalStatusDetail, GoalSummary, TaskItem } from "../../core/types.js";
import type { SearchRoot } from "../../platform/navigation.js";
import { config } from "../../core/config.js";
import { extractGoalsOverview, extractGoalSummariesFromText, dedupeGoalSummaries } from "../../platform/extractors.js";
import { goalIdFromUrl, normalizeDateInput } from "../../platform/navigation.js";
import { waitForBoolean } from "../../core/postconditions.js";
import type { GoalCacheEntry } from "../../client/entityCache.js";
import { navigatePage } from "../../core/index.js";

type DesireGoalInput = Array<{
  title: string;
  dueDate: string;
  goalTitle?: string;
  goalCategory?: string;
}>;

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
  submitTaskInput: (field: Locator) => Promise<void>;
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
  resolveDesireCategory: (desireTitle: string) => Promise<string | undefined>;
  updateGoalDueDateFromGoals: (goalTitle: string, dueDateInput: string) => Promise<boolean>;
  formatGoalDueLabel: (input: string) => string | null;
  waitForGoalDueLabel: (goalTitle: string, expectedLabel: string, timeoutMs?: number) => Promise<boolean>;
  openGoalEditPanel: () => Promise<Locator | null>;
  openGoalStatusMenu: () => Promise<boolean>;
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

  async function openCreateGoalFromDesire(desireTitle: string): Promise<void> {
    const page = deps.ensurePage();
    const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
    await navigatePage(page, `${base}/lifestorming`, { waitUntil: "domcontentloaded" }, { action: "createGoalsFromDesires:open-lifestorming" });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (!/Loading Lifestorming Page/i.test(text)) break;
      await page.waitForTimeout(200);
    }

    const anchor = page.getByText(desireTitle, { exact: false }).first();
    if ((await anchor.count()) === 0) {
      throw new Error(`could not locate desire in lifestorming: ${desireTitle}`);
    }

    for (let depth = 1; depth <= 6; depth += 1) {
      const row = anchor.locator(`xpath=ancestor::*[self::div or self::li or self::article or self::section][${depth}]`);
      if ((await row.count()) === 0) continue;
      const text = ((await row.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (!text.includes(desireTitle) || !/ADD TO GOALS/i.test(text)) continue;
      const clicked = await deps.tryClickByText(page, ["ADD TO GOALS"], row);
      if (!clicked) continue;
      const panelDeadline = Date.now() + 3000;
      while (Date.now() < panelDeadline) {
        const panel = await deps.resolveCreateGoalPanel();
        if (panel) return;
        if (/\/goals(\?|$)/.test(page.url())) {
          const dueInput = page.locator('input[type="date"]').first();
          if ((await dueInput.count()) > 0 && (await dueInput.isVisible().catch(() => false))) return;
        }
        await page.waitForTimeout(200);
      }
      break;
    }

    throw new Error(`could not open create-goal flow from Step 3 for desire: ${desireTitle}`);
  }

  async function finalizeCreatedGoal(goalTitle: string): Promise<void> {
    await deps.openGoalContext(goalTitle);
    await deps.waitForGoalDataLoaded();
    const page = deps.pageOrThrow();
    const goalId = goalIdFromUrl(page.url());
    const snapshot = await deps.captureCurrentGoalWorkspace().catch(() => null);
    if (goalId) {
      deps.cacheGoal({
        goalId,
        title: goalTitle,
        category: snapshot?.category,
        dueLabel: snapshot?.dueLabel,
        progressLabel: snapshot?.progressLabel
      });
    }
  }

  async function readGoalTaskSummaryFromGoals(goalTitle?: string): Promise<{
    title: string;
    taskPanelState: "tasks_present" | "add_tasks" | "empty";
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
  } | null> {
    if (!goalTitle) return null;
    return deps.withTemporaryPage(async (page) => {
      await navigatePage(page, `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }, { action: "readGoalTaskSummaryFromGoals" });
      const deadline = Date.now() + 3000;
      let text = "";
      while (Date.now() < deadline) {
        text = await page.locator("body").innerText().catch(() => "");
        if (/YOUR GOALS|SHOW GOALS:|Active \(\d+\)/i.test(text)) break;
        await page.waitForTimeout(250);
      }
      const goals = extractGoalSummariesFromText(text);
      const match = goals.find((goal) => normalizeKey(goal.title) === normalizeKey(goalTitle));
      if (!match) return null;
      return {
        title: match.title,
        taskPanelState: match.taskPanelState ?? "empty",
        taskSummaryLabel: match.taskSummaryLabel,
        taskPreviewItems: match.taskPreviewItems
      };
    }).catch(() => null);
  }

  function findCachedGoalSummary(goalTitle?: string, goalId?: string): {
    goalId?: string;
    title: string;
    taskPanelState: "tasks_present" | "add_tasks" | "empty";
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
  } | null {
    const normalizedTitle = normalizeKey(goalTitle);
    for (const entry of Object.values(deps.entityGoals())) {
      if (goalId && entry.goalId === goalId) {
        return {
          goalId: entry.goalId,
          title: entry.title ?? goalTitle ?? entry.goalId,
          taskPanelState: entry.taskPanelState ?? "empty",
          taskSummaryLabel: entry.taskSummaryLabel,
          taskPreviewItems: entry.taskPreviewItems
        };
      }
      if (normalizedTitle && normalizeKey(entry.title) === normalizedTitle) {
        return {
          goalId: entry.goalId,
          title: entry.title ?? goalTitle ?? entry.goalId,
          taskPanelState: entry.taskPanelState ?? "empty",
          taskSummaryLabel: entry.taskSummaryLabel,
          taskPreviewItems: entry.taskPreviewItems
        };
      }
    }
    return null;
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
    try {
      await waitForBoolean(
        deps.pageOrThrow(),
        async () => {
          await deps.ensureOnGoals();
          const [activeAfter, completeAfter, archivedAfter] = await Promise.all([
            deps.readGoalCount("Active"),
            deps.readGoalCount("Complete"),
            deps.readGoalCount("Archived")
          ]);
          const activeGoals = await createGoalsWorkflowInstance.listGoals("active");
          const activeHasGoal = goalTitle ? activeGoals.goals.some((goal) => goal.title === goalTitle) : undefined;

          if (nextStatus === "completed") {
            return Boolean((before.complete !== null && completeAfter !== null && completeAfter > before.complete) || activeHasGoal === false);
          }
          if (nextStatus === "archived") {
            return Boolean((before.archived !== null && archivedAfter !== null && archivedAfter > before.archived) || activeHasGoal === false);
          }
          return Boolean(
            (before.active !== null && activeAfter !== null && activeAfter > before.active) ||
            activeHasGoal === true ||
            (before.complete !== null && completeAfter !== null && completeAfter < before.complete) ||
            (before.archived !== null && archivedAfter !== null && archivedAfter < before.archived)
          );
        },
        timeoutMs,
        `goal status did not transition to ${nextStatus}${goalTitle ? ` for ${goalTitle}` : ""}`,
        250
      );
      return true;
    } catch {
      return false;
    }
  }

  async function hydrateGoalsList(page: Page): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 1800).catch(() => undefined);
      await page.waitForTimeout(150);
    }
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, -1800).catch(() => undefined);
      await page.waitForTimeout(100);
    }
  }

  async function resolveGoalsSection(page: Page): Promise<Locator | null> {
    const heading = page.getByText(/^YOUR GOALS$/i).first();
    if ((await heading.count()) === 0) return null;
    const candidates = [
      heading.locator("xpath=ancestor::*[self::section or self::article][1]"),
      heading.locator("xpath=ancestor::*[self::div][1]"),
      heading.locator("xpath=ancestor::*[self::div][2]"),
      heading.locator("xpath=ancestor::*[self::div][3]")
    ];
    for (const candidate of candidates) {
      if ((await candidate.count()) === 0) continue;
      const text = ((await candidate.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (/YOUR GOALS|SHOW GOALS:/i.test(text)) return candidate;
    }
    return null;
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
      const goalsSection = await resolveGoalsSection(page);
      if (normalized === "active") {
        await deps.tryClickByText(page, ["Active"], goalsSection ?? undefined);
      } else if (normalized === "complete") {
        await deps.tryClickByText(page, ["Complete", "Completed"], goalsSection ?? undefined);
      } else if (normalized === "archived") {
        await deps.tryClickByText(page, ["Archived"], goalsSection ?? undefined);
      } else {
        await deps.tryClickByText(page, ["All"], goalsSection ?? undefined);
      }
      await hydrateGoalsList(page);

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
            return (
              Boolean(text) &&
              /(START|VIEW|OPEN)/im.test(node.textContent || "") &&
              /Due\s+\d{2}\/\d{2}\/\d{2}/i.test(text)
            );
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

  async function finalizeCreatedGoal(goalTitle: string): Promise<void> {
    await deps.openGoalContext(goalTitle);
    await deps.waitForGoalDataLoaded();
    const page = deps.pageOrThrow();
    const goalId = goalIdFromUrl(page.url());
    const snapshot = await deps.captureCurrentGoalWorkspace().catch(() => null);
    if (goalId) {
      deps.cacheGoal({
        goalId,
        title: goalTitle,
        category: snapshot?.category,
        dueLabel: snapshot?.dueLabel,
        progressLabel: snapshot?.progressLabel
      });
    }
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

    async readGoalFull(goalTitle?: string, goalId?: string) {
      const shallowTaskSummary = await deps.getGoalTaskSummary(goalTitle, goalId).catch(() => null);
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const workspaceUrl = page.url();
      const snapshot = await deps.captureCurrentGoalWorkspace();
      const tasks = await this.listGoalTasks(goalTitle ?? snapshot.title, goalId ?? goalIdFromUrl(page.url()));
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url()) ?? tasks.goalId;
      const resolvedGoalTitle = goalTitle ?? snapshot.title ?? tasks.goalTitle;
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: resolvedGoalTitle, category: snapshot.category, dueLabel: snapshot.dueLabel, progressLabel: snapshot.progressLabel });
      return {
        goalId: resolvedGoalId,
        goalTitle: resolvedGoalTitle,
        url: workspaceUrl,
        workspaceVisible: await deps.isGoalWorkspaceVisible(),
        category: snapshot.category,
        dueLabel: snapshot.dueLabel,
        progressLabel: snapshot.progressLabel,
        statusBlocks: snapshot.statusBlocks,
        messages: snapshot.messages,
        tasks:
          tasks.tasks.length > 0
            ? tasks.tasks
            : (shallowTaskSummary?.taskPreviewItems ?? []).map((text) => ({ text, completed: false })),
        taskReadReason:
          tasks.tasks.length > 0
            ? tasks.reason
            : shallowTaskSummary?.taskSummaryLabel ?? tasks.reason,
        snippet: snapshot.snippet
      };
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
        const summary =
          block.prompts.find(
            (prompt) =>
              !/^(Updated\b|Not yet updated\b)/i.test(prompt) &&
              !/\?$/.test(prompt.trim()) &&
              prompt.trim().length > 0
          ) ?? undefined;
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

    async listGoalTasks(goalTitle?: string, goalId?: string): Promise<{ goalId?: string; goalTitle?: string; url: string; workspaceVisible: boolean; reason?: string; snippet?: string; tasks: TaskItem[] }> {
      const cachedSummary = findCachedGoalSummary(goalTitle, goalId);
      const summary = cachedSummary ?? await readGoalTaskSummaryFromGoals(goalTitle);
      if (summary?.taskPanelState === "add_tasks") {
        return {
          goalId: goalId ?? cachedSummary?.goalId,
          goalTitle: goalTitle ?? summary.title,
          url: deps.pageOrThrow().url(),
          workspaceVisible: await deps.isGoalWorkspaceVisible().catch(() => false),
          reason: summary.taskSummaryLabel ?? "No tasks",
          snippet: await deps.readBodySnippet().catch(() => ""),
          tasks: []
        };
      }
      if (summary?.taskPanelState === "tasks_present" && (summary.taskPreviewItems?.length ?? 0) > 0) {
        return {
          goalId: goalId ?? cachedSummary?.goalId,
          goalTitle: goalTitle ?? summary.title,
          url: deps.pageOrThrow().url(),
          workspaceVisible: await deps.isGoalWorkspaceVisible().catch(() => false),
          reason: summary.taskSummaryLabel,
          snippet: await deps.readBodySnippet().catch(() => ""),
          tasks: summary.taskPreviewItems!.map((text) => ({ text, completed: false }))
        };
      }

      if (await deps.isGoalContextOpen(goalTitle)) {
        await deps.openGoalForRead(goalTitle, goalId);
        const page = deps.pageOrThrow();
        try {
          await deps.ensureOnGoalTaskContext(goalTitle, goalId);
        } catch (error) {
          return {
            goalId: goalId ?? goalIdFromUrl(page.url()),
            goalTitle,
            url: page.url(),
            workspaceVisible: await deps.isGoalWorkspaceVisible(),
            reason: error instanceof Error ? error.message : String(error),
            snippet: await deps.readBodySnippet(),
            tasks: []
          };
        }
        const tasks = await deps.readVisibleTaskItems();
        const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
        return {
          goalId: resolvedGoalId,
          goalTitle,
          url: page.url(),
          workspaceVisible: await deps.isGoalWorkspaceVisible(),
          reason: tasks.length === 0 ? "no visible tasks extracted" : undefined,
          snippet: await deps.readBodySnippet(),
          tasks
        };
      }

      const goalSummary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (goalSummary?.taskPanelState === "add_tasks") {
        return { goalId: goalId ?? goalSummary.goalId, goalTitle: goalTitle ?? goalSummary.title, url: deps.pageOrThrow().url(), workspaceVisible: false, reason: goalSummary.taskSummaryLabel ?? "No tasks", snippet: await deps.readBodySnippet().catch(() => ""), tasks: [] };
      }
      if (goalSummary?.taskPanelState === "tasks_present" && (goalSummary.taskPreviewItems?.length ?? 0) > 0) {
        return { goalId: goalId ?? goalSummary.goalId, goalTitle: goalTitle ?? goalSummary.title, url: deps.pageOrThrow().url(), workspaceVisible: false, reason: goalSummary.taskSummaryLabel, snippet: await deps.readBodySnippet().catch(() => ""), tasks: goalSummary.taskPreviewItems!.map((text) => ({ text, completed: false })) };
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
        if (await deps.isGoalContextOpen(input.title)) {
          await finalizeCreatedGoal(input.title).catch(() => undefined);
          return { created: true, title: input.title };
        }
        await deps.ensureOnGoals();
        const activeAfter = await deps.readGoalCount("Active");
        if (activeBefore !== null && activeAfter !== null && activeAfter > activeBefore) {
          const activeGoals = await createGoalsWorkflowInstance.listGoals("active").catch(() => null);
          if (activeGoals?.goals?.some((goal) => goal.title === input.title)) {
            await finalizeCreatedGoal(input.title);
            return { created: true, title: input.title };
          }
        }
        const listed = await createGoalsWorkflowInstance.listGoals("active").catch(() => null);
        if (listed?.goals?.some((goal) => goal.title === input.title)) {
          await finalizeCreatedGoal(input.title);
          return { created: true, title: input.title };
        }
        await page.waitForTimeout(300);
      }
      const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      if (serverError) throw new Error(`create_goal failed: ${serverError}`);
      throw new Error(`create_goal submission did not increase active goal count (before=${activeBefore} title=${input.title} snippet=${snippet})`);
    },

    async createGoalsFromDesires(rawDesires: DesireGoalInput) {
      const desires = rawDesires
        .map((entry) => ({
          lookupTitle: entry.title.trim(),
          goalTitle: (entry.goalTitle ?? entry.title).trim(),
          goalCategory: entry.goalCategory?.trim(),
          dueDate: entry.dueDate.trim()
        }))
        .filter((entry) => entry.lookupTitle.length > 0);
      assertUniqueNormalized(desires.map((entry) => entry.lookupTitle), "desire titles");
      assertUniqueNormalized(desires.map((entry) => entry.goalTitle), "resulting goal titles");
      const created: string[] = [];
      for (const desire of desires) {
        const category = desire.goalCategory ?? await deps.resolveDesireCategory(desire.lookupTitle);
        if (!category) {
          throw new Error(`create_goals_from_desires requires goalCategory or cached desire category for "${desire.lookupTitle}"`);
        }
        if (!desire.dueDate) throw new Error(`create_goals_from_desires requires dueDate for "${desire.lookupTitle}"`);
        await assertGoalTitleAvailable(desire.goalTitle);
        await openCreateGoalFromDesire(desire.lookupTitle);
        const page = deps.ensurePage();
        const form = await deps.resolveCreateGoalPanel();
        const titleField = await deps.resolveGoalTitleInput(form ?? undefined);
        const existingTitle = (await titleField.inputValue().catch(() => "")).trim();
        if (!existingTitle || normalizeKey(existingTitle) !== normalizeKey(desire.goalTitle)) {
          await titleField.fill(desire.goalTitle);
        }
        if (desire.goalCategory && normalizeKey(desire.goalCategory) !== normalizeKey(category)) {
          const categorySet = await deps.selectCreateGoalCategory(desire.goalCategory);
          if (!categorySet) throw new Error(`could not select create_goals_from_desires override category: ${desire.goalCategory}`);
        }
        const due = (form ?? page).locator('input[type="date"]').first();
        const normalized = normalizeDateInput(desire.dueDate);
        if (!normalized) throw new Error(`invalid create_goals_from_desires dueDate: ${desire.dueDate}`);
        if ((await due.count()) > 0) {
          await due.fill(normalized);
        } else {
          throw new Error("could not locate create_goals_from_desires due date input");
        }
        let submitted = false;
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
        if (!submitted) await titleField.press("Enter");
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          if (await deps.isGoalContextOpen(desire.goalTitle)) {
            await finalizeCreatedGoal(desire.goalTitle).catch(() => undefined);
            break;
          }
          await deps.ensureOnGoals();
          const listed = await createGoalsWorkflowInstance.listGoals("active").catch(() => null);
          if (listed?.goals?.some((goal) => goal.title === desire.goalTitle)) {
            await finalizeCreatedGoal(desire.goalTitle);
            break;
          }
          await page.waitForTimeout(300);
        }
        created.push(desire.goalTitle);
      }
      return { created };
    },

    async updateGoalDueDate(goalTitle?: string, goalId?: string, dueDateInput?: string) {
      if (!dueDateInput?.trim()) throw new Error("update_goal requires dueDate");
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
        if (!labelMatches) throw new Error(`update_goal dueDate postcondition failed for ${resolvedGoalTitle}`);
      }
      return { updated: true, goalId: resolvedGoalId, goalTitle: resolvedGoalTitle, dueDate: normalizedDate };
    },

    async updateGoal(goalTitle: string, updates: { status?: "active" | "completed" | "archived"; dueDate?: string }) {
      if (!goalTitle.trim()) throw new Error("update_goal requires goalTitle");
      if (!updates.status && !updates.dueDate) throw new Error("update_goal requires status or dueDate");
      const applied: { goalTitle: string; dueDate?: string; status?: "active" | "completed" | "archived" } = { goalTitle };
      if (updates.dueDate) {
        const due = await this.updateGoalDueDate(goalTitle, undefined, updates.dueDate);
        applied.dueDate = due.dueDate;
      }
      if (updates.status) {
        await this.setGoalStatus(goalTitle, undefined, updates.status);
        applied.status = updates.status;
      }
      return applied;
    },

    async setGoalStatus(goalTitle?: string, goalId?: string, status?: "active" | "completed" | "archived") {
      if (!status) throw new Error("setGoalStatus requires status");
      await deps.ensureOnGoals();
      const before = {
        active: await deps.readGoalCount("Active"),
        complete: await deps.readGoalCount("Complete"),
        archived: await deps.readGoalCount("Archived")
      };
      const resolved = await resolveGoalIdentity(goalTitle, goalId);
      await deps.openGoalForRead(resolved.goalTitle, resolved.goalId);
      const opened = await deps.openGoalStatusMenu();
      const done = opened && await deps.clickGoalStatusAction(status);
      if (!done) throw new Error(`could not set goal status: ${status}`);
      const transitioned = await waitForGoalStatusChange(status, resolved.goalTitle, before);
      if (!transitioned) throw new Error(`setGoalStatus postcondition failed: ${status}`);
      return { goalTitle: resolved.goalTitle, goalId: resolved.goalId, status };
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
          for (const filterTexts of [["Active"], ["Complete", "Completed"], ["Archived"], ["All"]] as const) {
            await deps.tryClickByText(page, [...filterTexts]);
            const clickedAfterFilter = await deps.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
            if (clickedAfterFilter) break;
          }
        }
        if (await deps.waitForGoalContext(goalTitle, 2000)) return { started: true, goalTitle, goalId: goalIdFromUrl(deps.pageOrThrow().url()) };
        const byIds = await deps.listGoalIdsFromPage();
        for (const id of byIds) {
          await deps.openGoalContextById(id);
          if (await deps.waitForGoalContext(goalTitle, 1500)) return { started: true, goalTitle, goalId: id };
        }
        await navigatePage(page, `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }, { action: "startGoal:reset-goals" }).catch(() => undefined);
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
      for (const task of requestedTasks) {
        const field = await deps.resolveTaskInput();
        await field.fill(task);
        await deps.submitTaskInput(field);
        const observed = await deps.waitForTaskToAppear(task, 3000);
        addedTaskTexts.push(observed?.text ?? task);
        added += 1;
      }
      return { added, goalTitle, usedSuggestions: false, taskTexts: addedTaskTexts };
    },

    async removeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("remove_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      const resolvedGoalTitle = goalTitle ?? summary?.title;
      if (!resolvedGoalTitle) throw new Error(`remove_task could not resolve goal title for task: ${taskText}`);
      let resolvedGoalId = goalId ?? summary?.goalId;
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
      const resolvedGoalTitle = goalTitle ?? summary?.title;
      if (!resolvedGoalTitle) throw new Error(`complete_task could not resolve goal title for task: ${taskText}`);
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
      const resolvedGoalTitle = goalTitle ?? summary?.title;
      if (!resolvedGoalTitle) throw new Error(`uncomplete_task could not resolve goal title for task: ${taskText}`);
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

  };

  return createGoalsWorkflowInstance;
}
