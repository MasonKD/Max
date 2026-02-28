import type { BrowserContext, Locator, Page } from "playwright";
import type { AuthState, GoalStatusBlock, GoalSummary, TaskItem } from "./types.js";
import type { SearchRoot } from "./navigation.js";
import { config } from "./config.js";
import { extractGoalsOverview, extractGoalSummariesFromText, dedupeGoalSummaries } from "./extractors.js";
import { readTaskPanelSnapshotDiagnostic, readBodySnippet } from "./diagnostics.js";
import { goalIdFromUrl, normalizeDateInput, titleCase } from "./navigation.js";
import { selectors, textSelectors } from "./selectors.js";
import { StateError } from "./recovery.js";
import { knownRoutes, type KnownRouteId } from "./catalog.js";
import type { GoalCacheEntry } from "./entityCache.js";

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
  discoverGoalIds: (waitMs?: unknown) => Promise<{ goalIds: string[]; waitMs: number; loadingVisible: boolean }>;
  tryOpenAnyGoalByLink: () => Promise<boolean>;
  tryClickStartInGoalsList: () => Promise<boolean>;
  tryClickGoalCardAction: (goalTitle: string, actionTexts: string[]) => Promise<boolean>;
  resolveTaskInput: () => Promise<Locator>;
  resolveTaskRow: (taskText: string) => Promise<Locator>;
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
  entityGoals: () => Record<string, GoalCacheEntry>;
  isGoalContextOpen: (goalTitle?: string) => Promise<boolean>;
  tryPromoteDesireToGoal: (desireTitle: string) => Promise<boolean>;
};

export function createGoalsWorkflow(deps: GoalsWorkflowDeps) {
  return {
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
        const rows = Array.from(document.querySelectorAll("article, section, li, div"));
        const extracted: GoalSummary[] = [];
        const categories = ["health", "work", "love", "family", "social", "fun", "dreams", "meaning"];

        for (const row of rows) {
          const text = (row.textContent || "").replace(/\s+/g, " ").trim();
          if (!text || !/start|tasks completed|due/i.test(text)) continue;
          const lines = (row.textContent || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
          const title = lines.find((line) => !/start|view|archive|complete|due|tasks completed|meaning|health|work|love|family|social|fun|dreams/i.test(line)) ?? "";
          if (!title || title.length < 2) continue;

          const html = row.outerHTML;
          const idMatch = html.match(/goalId=([A-Za-z0-9_-]+)/i) ?? html.match(/data-goal-id=["']?([A-Za-z0-9_-]+)/i);
          const category = lines.find((line) => categories.includes(line.toLowerCase()));
          const dueLabel = lines.find((line) => /^Due\s/i.test(line));
          const progressLabel = lines.find((line) => /tasks completed|\d+%/i.test(line));
          const summaryIndex = lines.findIndex((line) => /tasks completed|No tasks/i.test(line));
          const taskSummaryLabel = summaryIndex !== -1 ? lines[summaryIndex] : undefined;
          const taskPreviewItems = lines.filter(
            (line) => line !== title && line !== category && line !== dueLabel && line !== progressLabel && line !== taskSummaryLabel && !/^(START|ADD TASKS)$/i.test(line) && line.length > 0
          ).slice(0, 12);
          const taskPanelState =
            taskSummaryLabel && /tasks completed/i.test(taskSummaryLabel)
              ? "tasks_present"
              : /No tasks/i.test(taskSummaryLabel ?? "") || lines.some((line) => /^ADD TASKS$/i.test(line))
                ? "add_tasks"
                : "empty";
          extracted.push({ title, goalId: idMatch?.[1], category, dueLabel, progressLabel, taskSummaryLabel, taskPreviewItems, taskPanelState });
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

      const stream = await deps.discoverGoalIds(waitMs);
      const merged = new Map<string, { goalId: string; title?: string }>();
      for (const item of dom) merged.set(item.goalId, item);
      for (const id of stream.goalIds) if (!merged.has(id)) merged.set(id, { goalId: id });

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
        sources: { domGoalIds: dom.length, streamGoalIds: stream.goalIds.length },
        waitMs: stream.waitMs,
        loadingVisible: stream.loadingVisible
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

      const tasks = await page.evaluate(() => {
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
        const noise = /^(Add new task|Use the task suggestion tool|Select Tasks|Cancel|Set Tasks|Type your message|⌘ \+ Enter to send|TASKS)$/i;
        const taskLike = (text: string): boolean => /\b(research|discuss|reach out|plan|schedule|call|book|create|begin|talk|choose|review|write|set up|find|contact)\b/i.test(text) || text.length > 18;
        const out: Array<{ text: string; completed: boolean }> = [];
        const panelAnchor = Array.from(document.querySelectorAll("body *")).find((el) => /How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(normalize((el as HTMLElement).innerText || el.textContent || "")));
        const panelRoot = panelAnchor?.closest("section,article,div") ?? panelAnchor?.parentElement ?? null;
        const collectFromScope = (root: ParentNode): void => {
          for (const row of Array.from(root.querySelectorAll("li, article, section, div"))) {
            const raw = normalize((row as HTMLElement).innerText || row.textContent || "");
            if (!raw || noise.test(raw) || /How will you accomplish|Tasks are generated based/i.test(raw)) continue;
            const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            const completed = checkbox ? Boolean(checkbox.checked) : /\b(completed|done)\b/i.test(raw);
            const lines = raw.split(/\n+/).map(normalize).filter(Boolean);
            const candidate = lines.find((line) => !noise.test(line) && !/^(How will you accomplish|Tasks are generated based)/i.test(line) && taskLike(line));
            if (checkbox || candidate) {
              const text = candidate ?? raw;
              if (text.length > 3) out.push({ text, completed });
            }
          }
        };
        if (panelRoot) collectFromScope(panelRoot);
        const lines = (document.body.innerText || "").split(/\n+/).map(normalize).filter(Boolean);
        const start = lines.findIndex((line) => /How will you accomplish/i.test(line));
        if (start !== -1) {
          for (let i = start + 1; i < lines.length; i += 1) {
            const line = lines[i];
            if (noise.test(line) || /Tasks are generated based/i.test(line)) break;
            if (/Current Goal|GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK/i.test(line)) continue;
            if (taskLike(line)) out.push({ text: line, completed: false });
          }
        }
        const dedup = new Map<string, { text: string; completed: boolean }>();
        for (const item of out) {
          if (item.text.length > 3 && !/SELF-IMPROVE|SELF-AWARENESS|COMMUNITY|CURRENT GOAL|GOAL STATUS|Not yet updated|What do you|Where can you|How are you thinking|What did you learn|Hello, I’m here to help/i.test(item.text) && !dedup.has(item.text)) {
            dedup.set(item.text, item);
          }
        }
        return [...dedup.values()];
      });

      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
      return { goalId: resolvedGoalId, goalTitle, url: page.url(), workspaceVisible: await deps.isGoalWorkspaceVisible(), reason: tasks.length === 0 ? "no visible tasks extracted" : undefined, snippet: await deps.readBodySnippet(), tasks };
    },

    async readGoalChat(goalTitle?: string, goalId?: string) {
      await deps.openGoalForRead(goalTitle, goalId);
      const page = deps.pageOrThrow();
      const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
      const snapshot = await deps.captureCurrentGoalWorkspace();
      if (resolvedGoalId) deps.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
      return { goalId: resolvedGoalId, goalTitle, url: page.url(), messages: snapshot.messages };
    },

    async createGoal(input: { title: string; category?: string; dueDate?: string }) {
      const page = deps.ensurePage();
      if (!input.title.trim()) throw new Error("create_goal requires title");
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
      if (input.category) {
        const categorySet = await deps.selectCreateGoalCategory(input.category);
        if (!categorySet) throw new Error(`could not select create_goal category: ${input.category}`);
      }
      if (input.dueDate) {
        const due = (form ?? page).locator('input[type="date"]').first();
        if ((await due.count()) > 0) {
          const normalized = normalizeDateInput(input.dueDate);
          if (normalized) await due.fill(normalized);
        }
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
        if (activeBefore !== null && activeAfter !== null && activeAfter > activeBefore) return { created: true, title: input.title };
        await page.waitForTimeout(300);
      }
      const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      if (serverError) throw new Error(`create_goal failed: ${serverError}`);
      throw new Error(`create_goal submission did not increase active goal count (before=${activeBefore} title=${input.title} snippet=${snippet})`);
    },

    async createGoalsFromDesires(rawDesires: unknown[]) {
      const desires = rawDesires.map((entry) => {
        if (typeof entry === "string") return { title: entry };
        if (typeof entry === "object" && entry !== null) {
          const obj = entry as Record<string, unknown>;
          return { title: String(obj.title ?? ""), category: typeof obj.category === "string" ? obj.category : undefined, dueDate: typeof obj.dueDate === "string" ? obj.dueDate : undefined };
        }
        return { title: "" };
      }).filter((entry) => entry.title.trim().length > 0);
      const created: string[] = [];
      for (const desire of desires) {
        const promoted = await deps.tryPromoteDesireToGoal(desire.title);
        if (!promoted) await this.createGoal(desire);
        created.push(desire.title);
      }
      return { created };
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
        const streamIds = (await deps.discoverGoalIds()).goalIds;
        if (streamIds.length > 0) {
          await deps.openGoalContextById(streamIds[0]);
          if (await deps.waitForGoalContext(undefined, 2500)) return { started: true, goalId: streamIds[0] };
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
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState === "empty") throw new Error(`add_tasks refused: goal has no task entry point from /goals summary (${summary.title})`);
      await deps.ensureOnGoalTaskContext(goalTitle, goalId);
      const page = deps.pageOrThrow();
      if (useSuggestions) {
        await deps.clickByText(page, ["Use the task suggestion tool", "Select Tasks"]);
        for (const task of tasks) await deps.tryClickByText(page, [task]);
        await deps.tryClickByText(page, ["Set Tasks", "Add", "Save"]);
        return { added: tasks.length, goalTitle, usedSuggestions: true };
      }
      let added = 0;
      if (summary?.taskPanelState === "add_tasks") await deps.tryClickByText(page, ["ADD TASKS", "Add Tasks", "Use the task suggestion tool"]);
      for (const task of tasks.filter((t) => t.trim().length > 0)) {
        await deps.tryClickByText(page, ["Add new task", "Add task", "New task"]);
        const field = await deps.resolveTaskInput();
        await field.fill(task);
        await field.press("Enter");
        added += 1;
      }
      return { added, goalTitle, usedSuggestions: false };
    },

    async removeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("remove_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState !== "tasks_present") throw new Error(`remove_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
      await deps.ensureOnGoalTaskContext(goalTitle, goalId);
      const row = await deps.resolveTaskRow(taskText);
      const removed = (await deps.tryClickByText(deps.pageOrThrow(), ["Delete", "Remove", "Trash"], row)) || (await deps.tryClickByText(deps.pageOrThrow(), ["×"], row));
      if (!removed) throw new Error(`could not remove task: ${taskText}`);
      return { removed: true };
    },

    async completeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("complete_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState !== "tasks_present") throw new Error(`complete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
      await deps.ensureOnGoalTaskContext(goalTitle, goalId);
      const row = await deps.resolveTaskRow(taskText);
      const checkbox = row.locator('input[type="checkbox"]').first();
      if ((await checkbox.count()) > 0) {
        if (!(await checkbox.isChecked())) await checkbox.click();
        return { completed: true };
      }
      const toggled = await deps.tryClickByText(deps.pageOrThrow(), ["Complete", "Mark complete", "Done"], row);
      if (!toggled) throw new Error(`could not complete task: ${taskText}`);
      return { completed: true };
    },

    async uncompleteTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string) {
      if (!taskText.trim()) throw new Error("uncomplete_task requires taskText");
      const summary = await deps.getGoalTaskSummary(goalTitle, goalId);
      if (summary?.taskPanelState !== "tasks_present") throw new Error(`uncomplete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
      await deps.ensureOnGoalTaskContext(goalTitle, goalId);
      const row = await deps.resolveTaskRow(taskText);
      const checkbox = row.locator('input[type="checkbox"]').first();
      if ((await checkbox.count()) > 0) {
        if (await checkbox.isChecked()) await checkbox.click();
        return { uncompleted: true };
      }
      const toggled = await deps.tryClickByText(deps.pageOrThrow(), ["Uncomplete", "Reopen", "Undo"], row);
      if (!toggled) throw new Error(`could not uncomplete task: ${taskText}`);
      return { uncompleted: true };
    },

    async completeGoal(goalTitle?: string, goalId?: string) {
      await deps.ensureOnGoals();
      if (goalId) {
        await deps.openGoalContextById(goalId);
      } else if (goalTitle) {
        const clicked = await deps.tryClickGoalCardAction(goalTitle, ["COMPLETE", "Complete", "Mark Complete"]);
        if (clicked) return { completed: true, goalTitle, goalId };
        await deps.openGoalContext(goalTitle);
      }
      const page = deps.pageOrThrow();
      await deps.tryClickByText(page, ["EDIT", "Edit"]);
      const done = await deps.tryClickByText(page, ["COMPLETE", "Complete", "Mark Complete"]);
      if (!done) throw new Error("could not complete goal");
      return { completed: true, goalTitle, goalId: goalId ?? goalIdFromUrl(deps.pageOrThrow().url()) };
    },

    async archiveGoal(goalTitle?: string, goalId?: string) {
      await deps.ensureOnGoals();
      if (goalId) {
        await deps.openGoalContextById(goalId);
      } else if (goalTitle) {
        const clicked = await deps.tryClickGoalCardAction(goalTitle, ["ARCHIVE", "Archive"]);
        if (clicked) return { archived: true, goalTitle, goalId };
        await deps.openGoalContext(goalTitle);
      }
      const page = deps.pageOrThrow();
      await deps.tryClickByText(page, ["EDIT", "Edit"]);
      const done = await deps.tryClickByText(page, ["ARCHIVE", "Archive"]);
      if (!done) throw new Error("could not archive goal");
      return { archived: true, goalTitle, goalId: goalId ?? goalIdFromUrl(deps.pageOrThrow().url()) };
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

    async deleteGoalApi(goalId?: string) {
      if (!goalId) throw new Error("delete_goal_api requires payload.goalId");
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();
      const result = await page.evaluate(async ({ id }) => {
        const global = window as unknown as Record<string, unknown>;
        const firebase = global.firebase as
          | {
              apps?: unknown[];
              firestore?: () => { collection: (name: string) => { doc: (docId: string) => { delete: () => Promise<void> } } };
            }
          | undefined;
        if (firebase?.firestore) {
          await firebase.firestore().collection("goals").doc(id).delete();
          return { ok: true, method: "firebase.firestore" };
        }
        return { ok: false, method: "unavailable" };
      }, { id: goalId });
      if (!result.ok) throw new Error("delete_goal_api unavailable: firebase sdk is not exposed in this app context");
      return { deleted: true, goalId, method: result.method };
    }
  };
}
