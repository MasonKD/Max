import type { Locator, Page } from "playwright";
import { config } from "./config.js";
import { readBodySnippet } from "./diagnostics.js";
import { extractGoalWorkspaceSnapshot } from "./goals.js";
import { extractTaskItemsFromGoalPage } from "./extractors.js";
import type { SearchRoot } from "./navigation.js";
import { goalIdFromUrl, normalizeDateInput, titleCase } from "./navigation.js";
import { StateError } from "./recovery.js";
import { selectors, textSelectors } from "./selectors.js";
import type { GoalStatusBlock, TaskItem } from "./types.js";

export type GoalsSupportDeps = {
  pageOrThrow: () => Page;
  ensureOnGoals: () => Promise<void>;
  tryClickByText: (root: SearchRoot, texts: string[], scope?: Locator) => Promise<boolean>;
  openGoalContextById: (goalId: string) => Promise<void>;
  startGoal: (goalTitle?: string, goalId?: string) => Promise<{ started: boolean; goalTitle?: string; goalId?: string }>;
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
  listGoals: (filter: string) => Promise<{ goals: Array<{ title: string; goalId?: string; taskPanelState?: "tasks_present" | "add_tasks" | "empty"; taskSummaryLabel?: string; taskPreviewItems?: string[] }> }>;
};

type FirestoreAuthContext = {
  projectId: string;
  userId: string;
  accessToken: string;
};

export function createGoalsSupport(deps: GoalsSupportDeps) {
  let firestoreAuthCache: FirestoreAuthContext | null = null;
  const taskDocIds = new Map<string, string>();

  return {
    async getGoalTaskSummary(goalTitle?: string, goalId?: string) {
      if (goalId) {
        const listed = await deps.listGoals("active");
        const byId = listed.goals.find((goal) => goal.goalId === goalId);
        if (byId?.taskPanelState) {
          return {
            goalId,
            title: byId.title ?? goalTitle ?? goalId,
            taskPanelState: byId.taskPanelState,
            taskSummaryLabel: byId.taskSummaryLabel,
            taskPreviewItems: byId.taskPreviewItems
          };
        }
      }

      const listed = await deps.listGoals("active");
      const resolvedTitle = goalTitle;
      const match = listed.goals.find((goal) => (goalId && goal.goalId === goalId) || (resolvedTitle && goal.title === resolvedTitle));
      if (!match) return null;
      return {
        goalId: match.goalId ?? (goalTitle ? deps.findGoalIdByTitle(goalTitle) : undefined),
        title: match.title,
        taskPanelState: match.taskPanelState ?? "empty",
        taskSummaryLabel: match.taskSummaryLabel,
        taskPreviewItems: match.taskPreviewItems
      };
    },

    async resolveGoalCard(goalTitle: string): Promise<Locator | null> {
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();
      const title = page.getByText(goalTitle, { exact: false }).first();
      if ((await title.count()) === 0) return null;

      const containers = [
        title.locator("xpath=ancestor::*[self::article or self::section][1]"),
        title.locator("xpath=ancestor::*[self::div][1]"),
        title.locator("xpath=ancestor::*[self::div][2]"),
        title.locator("xpath=ancestor::*[self::div][3]"),
        title.locator("xpath=ancestor::*[self::div][4]")
      ];

      for (const container of containers) {
        if ((await container.count()) === 0) continue;
        const text = ((await container.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
        if (!text.includes(goalTitle)) continue;
        if (!/START|Due |tasks completed|No tasks|ADD TASKS/i.test(text)) continue;
        return container;
      }
      return null;
    },

    async resolveTaskRowInGoalCard(goalTitle: string, taskText: string): Promise<Locator | null> {
      const card = await this.resolveGoalCard(goalTitle);
      if (!card) return null;
      const normalized = normalizeTaskText(taskText);

      const exactSpan = card.locator("span").filter({ hasText: taskText }).first();
      if ((await exactSpan.count()) > 0) {
        const row = exactSpan.locator("xpath=ancestor::*[self::div][1]");
        if ((await row.count()) > 0) return row;
      }

      const rows = card.locator("div");
      const count = await rows.count();
      for (let i = 0; i < count; i += 1) {
        const row = rows.nth(i);
        const text = normalizeTaskText(await row.innerText().catch(() => ""));
        if (!text) continue;
        if (text !== normalized) continue;
        const buttons = row.locator("button");
        if ((await buttons.count()) > 0) return row;
      }

      return null;
    },

    async readGoalCardTaskCompletion(goalTitle: string): Promise<{ completed: number; total: number } | null> {
      const summary = await this.getGoalTaskSummary(goalTitle);
      const label = summary?.taskSummaryLabel?.trim() ?? "";
      const match = label.match(/(\d+)\s*\/\s*(\d+)\s*tasks completed/i);
      if (!match) return null;
      return { completed: Number(match[1]), total: Number(match[2]) };
    },

    async waitForGoalCardTaskCompletionDelta(goalTitle: string, previousCompleted: number, delta: number, timeoutMs = 2500): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const counts = await this.readGoalCardTaskCompletion(goalTitle);
        if (counts && counts.completed === previousCompleted + delta) return true;
        await deps.pageOrThrow().waitForTimeout(200);
      }
      return false;
    },

    async clickGoalCardTaskToggle(goalTitle: string, taskText: string): Promise<boolean> {
      const row = await this.resolveTaskRowInGoalCard(goalTitle, taskText);
      if (!row) return false;
      await row.hover().catch(() => undefined);
      const buttons = row.locator("button");
      const count = await buttons.count();
      if (count === 0) return false;
      await buttons.first().click({ timeout: 1500 }).catch(() => undefined);
      return true;
    },

    async clickGoalCardTaskRemove(goalTitle: string, taskText: string): Promise<boolean> {
      const row = await this.resolveTaskRowInGoalCard(goalTitle, taskText);
      if (!row) return false;
      await row.hover().catch(() => undefined);

      const explicit = row.locator('button[aria-label*="delete" i], button[aria-label*="remove" i], button[aria-label*="trash" i]').first();
      if ((await explicit.count()) > 0) {
        await explicit.click({ timeout: 1500 }).catch(() => undefined);
        return true;
      }

      const buttons = row.locator("button");
      const count = await buttons.count();
      if (count >= 2) {
        await buttons.nth(1).click({ timeout: 1500 }).catch(() => undefined);
        return true;
      }

      return false;
    },

    async getFirestoreAuthContext(): Promise<FirestoreAuthContext> {
      if (firestoreAuthCache) return firestoreAuthCache;
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();

      const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === "session");
      if (!sessionCookie?.value) {
        throw new Error("could not locate selfmax session cookie");
      }

      const payload = parseJwtPayload(sessionCookie.value);
      const userId = typeof payload?.user_id === "string" ? payload.user_id : typeof payload?.sub === "string" ? payload.sub : "";
      const projectId = typeof payload?.aud === "string" ? payload.aud : "";
      if (!userId || !projectId) {
        throw new Error("could not derive firestore user/project context from session cookie");
      }

      const token = await captureFirestoreAccessToken(page);
      firestoreAuthCache = { projectId, userId, accessToken: token };
      return firestoreAuthCache;
    },

    async deleteTaskViaFirestore(goalId: string, taskText: string): Promise<boolean> {
      const auth = await this.getFirestoreAuthContext();
      const tempPage = await deps.pageOrThrow().context().newPage();
      try {
        await tempPage.goto("about:blank").catch(() => undefined);
        const cachedDocId = taskDocIds.get(taskDocCacheKey(goalId, taskText));
        if (cachedDocId) {
          return await tempPage.evaluate(async ({ projectId, accessToken, userId, docId }) => {
            const headers = {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            };
            const docName = `projects/${projectId}/databases/(default)/documents/users/${userId}/actions/${docId}`;
            const commitRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                writes: [{ delete: docName }]
              })
            });
            if (!commitRes.ok) {
              throw new Error(`commit failed (${commitRes.status}): ${await commitRes.text()}`);
            }
            return true;
          }, { projectId: auth.projectId, accessToken: auth.accessToken, userId: auth.userId, docId: cachedDocId });
        }
        return await tempPage.evaluate(async ({ projectId, userId, accessToken, desiredGoalId, desiredTaskText }) => {
          const headers = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          };
          const parent = `projects/${projectId}/databases/(default)/documents/users/${userId}`;
          const queryRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: "actions" }],
                where: {
                  compositeFilter: {
                    op: "AND",
                    filters: [
                      {
                        fieldFilter: {
                          field: { fieldPath: "desireId" },
                          op: "EQUAL",
                          value: { stringValue: desiredGoalId }
                        }
                      },
                      {
                        fieldFilter: {
                          field: { fieldPath: "description" },
                          op: "EQUAL",
                          value: { stringValue: desiredTaskText }
                        }
                      }
                    ]
                  }
                }
              },
              parent
            })
          });
          if (!queryRes.ok) {
            throw new Error(`runQuery failed (${queryRes.status}): ${await queryRes.text()}`);
          }
          const rows = await queryRes.json();
          const match = Array.isArray(rows) ? rows.find((row) => row?.document?.name) : null;
          const docName = typeof match?.document?.name === "string" ? match.document.name : "";
          if (!docName) return false;

          const commitRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              writes: [{ delete: docName }]
            })
          });
          if (!commitRes.ok) {
            throw new Error(`commit failed (${commitRes.status}): ${await commitRes.text()}`);
          }
          return true;
        }, { ...auth, desiredGoalId: goalId, desiredTaskText: taskText });
      } finally {
        await tempPage.close().catch(() => undefined);
      }
    },

    async updateGoalStatusViaFirestore(goalId: string, status: "active" | "completed" | "archived"): Promise<boolean> {
      const auth = await this.getFirestoreAuthContext();
      const tempPage = await deps.pageOrThrow().context().newPage();
      try {
        await tempPage.goto("about:blank").catch(() => undefined);
        return await tempPage.evaluate(async ({ projectId, userId, accessToken, goalId: desiredGoalId, status: nextStatus }) => {
          const headers = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          };
          const docName = `projects/${projectId}/databases/(default)/documents/users/${userId}/desires/${desiredGoalId}`;
          const commitRes = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              writes: [
                {
                  update: {
                    name: docName,
                    fields: {
                      status: { stringValue: nextStatus }
                    }
                  },
                  updateMask: {
                    fieldPaths: ["status"]
                  },
                  currentDocument: {
                    exists: true
                  }
                }
              ]
            })
          });
          if (!commitRes.ok) {
            throw new Error(`commit failed (${commitRes.status}): ${await commitRes.text()}`);
          }
          return true;
        }, { projectId: auth.projectId, userId: auth.userId, accessToken: auth.accessToken, goalId, status });
      } finally {
        await tempPage.close().catch(() => undefined);
      }
    },

    async waitForTaskDocumentWrite(goalId: string, taskText: string, timeoutMs = 4000): Promise<string | null> {
      const page = deps.pageOrThrow();
      return new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => {
          page.off("request", onRequest);
          resolve(null);
        }, timeoutMs);

        const onRequest = (request: { url: () => string; postData: () => string | null }): void => {
          const url = request.url();
          if (!/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Write\/channel/i.test(url)) return;
          const body = decodeURIComponent(request.postData() || "");
          if (!body.includes(taskText)) return;
          const match = body.match(/documents\/users\/[^/]+\/actions\/([A-Za-z0-9_-]+)/i);
          if (!match?.[1]) return;
          clearTimeout(timeout);
          page.off("request", onRequest);
          taskDocIds.set(taskDocCacheKey(goalId, taskText), match[1]);
          resolve(match[1]);
        };

        page.on("request", onRequest);
      });
    },

    async discoverGoalIds(waitMs?: unknown): Promise<{ goalIds: string[]; waitMs: number; loadingVisible: boolean }> {
      const page = deps.pageOrThrow();
      await deps.ensureOnGoals();
      const wait = typeof waitMs === "number" && Number.isFinite(waitMs) ? Math.max(0, Math.min(waitMs, 30000)) : 1200;

      const chunks: string[] = [];
      const onResponse = async (res: { url: () => string; text: () => Promise<string> }): Promise<void> => {
        const url = res.url();
        if (!/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/i.test(url)) return;
        try {
          const text = await res.text();
          if (text) chunks.push(text.slice(0, 200_000));
        } catch {
        }
      };

      page.on("response", onResponse);
      try {
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page.waitForTimeout(wait);
      } finally {
        page.off("response", onResponse);
      }

      const source = chunks.join("\n");
      const ids = new Set<string>();
      for (const match of source.matchAll(/documents\/goals\/([A-Za-z0-9_-]+)/g)) if (match[1]) ids.add(match[1]);
      for (const match of source.matchAll(/"goalId":"([A-Za-z0-9_-]+)"/g)) if (match[1]) ids.add(match[1]);
      for (const match of source.matchAll(/goalId=([A-Za-z0-9_-]+)/g)) if (match[1]) ids.add(match[1]);

      const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      return { goalIds: [...ids], waitMs: wait, loadingVisible: /loading/i.test(bodyText) };
    },

    async ensureOnGoalTaskContext(goalTitle?: string, goalId?: string): Promise<void> {
      if (goalId) {
        await this.openGoalContextById(goalId);
        await this.waitForGoalDataLoaded();
      } else if (goalTitle) {
        await this.openGoalContext(goalTitle);
      } else if (!deps.pageOrThrow().url().includes("/self-maximize")) {
        await deps.startGoal();
      }

      await this.openTaskPanel();
      await this.ensureTaskPanelVisible();
    },

    async openTaskPanel(): Promise<void> {
      const page = deps.pageOrThrow();
      const tabByRole = page.getByRole("button", { name: /^tasks$/i }).first();
      const attempts: Array<() => Promise<void>> = [
        async () => {
          if ((await tabByRole.count()) > 0 && (await tabByRole.isVisible().catch(() => false))) {
            await tabByRole.click({ timeout: 2000 }).catch(() => undefined);
          }
        },
        async () => {
          await deps.tryClickByText(page, textSelectors(selectors.tasks.taskTab));
        },
        async () => {
          await deps.tryClickByText(page, ["EDIT", "Edit"]);
          if ((await tabByRole.count()) > 0 && (await tabByRole.isVisible().catch(() => false))) {
            await tabByRole.click({ timeout: 2000 }).catch(() => undefined);
          } else {
            await deps.tryClickByText(page, textSelectors(selectors.tasks.taskTab));
          }
        }
      ];

      for (const attempt of attempts) {
        await attempt();
        if (await this.waitForTaskPanelData(1200)) return;
      }
      throw new StateError("task panel did not open", {
        action: "inspect TASKS selector tiers",
        detail: "button click succeeded but no task panel anchor became visible"
      });
    },

    async openGoalContext(goalTitle: string): Promise<void> {
      await deps.ensureOnGoals();
      const page = deps.pageOrThrow();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const clicked = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
        if (!clicked) {
          await deps.tryClickByText(page, ["All"]);
          const clickedAfterReset = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
          if (!clickedAfterReset) {
            await this.tryOpenAnyGoalByLink();
          }
        }
        if (await this.waitForGoalContext(goalTitle, 2000)) return;
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
      throw new Error(`could not open goal context for: ${goalTitle}`);
    },

    async openGoalForRead(goalTitle?: string, goalId?: string): Promise<void> {
      if (goalId) {
        await this.openGoalContextById(goalId);
        if (!(await this.waitForGoalContext(goalTitle, 2500))) {
          throw new Error(`could not open goal context by goalId for read: ${goalId}`);
        }
        await this.waitForGoalDataLoaded();
        return;
      }
      if (goalTitle) {
        await this.openGoalContext(goalTitle);
        await this.waitForGoalDataLoaded();
        return;
      }
      if (await this.isGoalContextOpen()) {
        await this.waitForGoalDataLoaded();
        return;
      }
      await deps.startGoal();
      await this.waitForGoalDataLoaded();
    },

    async isGoalWorkspaceVisible(): Promise<boolean> {
      const page = deps.pageOrThrow();
      if (!/\/self-maximize(\?|$)/.test(page.url())) return false;
      const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      return /Current Goal|GOAL STATUS|Type your message|⌘ \+ Enter to send/i.test(bodyText);
    },

    async readBodySnippet(): Promise<string> {
      return readBodySnippet(deps.pageOrThrow());
    },

    async captureCurrentGoalWorkspace(): Promise<{
      title?: string;
      category?: string;
      dueLabel?: string;
      progressLabel?: string;
      statusBlocks: GoalStatusBlock[];
      tabs: string[];
      messages: string[];
      snippet: string;
    }> {
      const text = await deps.pageOrThrow().locator("body").innerText().catch(() => "");
      const snapshot = extractGoalWorkspaceSnapshot(text);
      return {
        title: snapshot.goalTitle,
        category: snapshot.category,
        dueLabel: snapshot.dueLabel,
        progressLabel: snapshot.progressLabel,
        statusBlocks: snapshot.statusBlocks,
        tabs: snapshot.tabs,
        messages: snapshot.messages,
        snippet: snapshot.snippet
      };
    },

    async waitForGoalDataLoaded(timeoutMs = 2500, page = deps.pageOrThrow()): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        if (!/Loading\.\.\.|Loading Goal/i.test(text) && /Current Goal|GOAL STATUS|Type your message|⌘ \+ Enter to send/i.test(text)) return;
        await page.waitForTimeout(250);
      }
    },

    async waitForTaskPanelData(timeoutMs = 1500, page = deps.pageOrThrow()): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await this.isTaskPanelVisible()) return true;
        const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        if (/How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(bodyText)) return true;
        await page.waitForTimeout(250);
      }
      return false;
    },

    async isGoalContextOpen(goalTitle?: string): Promise<boolean> {
      const page = deps.pageOrThrow();
      if (page.url().includes("/self-maximize")) return true;
      const currentGoal = page.getByText(/Current Goal/i).first();
      if ((await currentGoal.count()) === 0) return false;
      if (!goalTitle) return true;
      const goalText = page.getByText(goalTitle, { exact: false }).first();
      return (await goalText.count()) > 0;
    },

    async resolveGoalTitleInput(scope?: SearchRoot): Promise<Locator> {
      const page = deps.pageOrThrow();
      const root: SearchRoot = scope ?? page;

      const byPlaceholder = root.locator('textarea[placeholder*="E.g." i], textarea[placeholder*="goal" i]').first();
      if ((await byPlaceholder.count()) > 0) return byPlaceholder;

      const textareas = root.locator("textarea");
      const textareasCount = await textareas.count();
      for (let i = 0; i < textareasCount; i += 1) {
        const field = textareas.nth(i);
        const placeholder = ((await field.getAttribute("placeholder")) ?? "").toLowerCase();
        if (placeholder.includes("type your message")) continue;
        return field;
      }

      const titleField = root.locator('input[type="text"], input:not([type])').first();
      if ((await titleField.count()) > 0) return titleField;

      const anyField = root.locator("textarea, input").first();
      if ((await anyField.count()) > 0) return anyField;

      throw new Error("could not locate create-goal title input");
    },

    async resolveCreateGoalPanel(): Promise<Locator | null> {
      const page = deps.pageOrThrow();
      const heading = page.getByText(/Create a New Goal/i).first();
      if ((await heading.count()) === 0) return null;
      const panel = heading.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
      return (await panel.count()) === 0 ? null : panel;
    },

    async selectCreateGoalCategory(category: string): Promise<boolean> {
      const page = deps.pageOrThrow();
      const prompt = page.getByText(/Choose a category for your goal/i).first();
      const variants = [titleCase(category), category.toUpperCase(), category.toLowerCase()];
      if ((await prompt.count()) > 0) {
        const container = prompt.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
        const clicked = await deps.tryClickByText(container, variants);
        if (clicked) return true;
      }
      return deps.tryClickByText(page, variants);
    },

    normalizeDateInput(input: string): string | null {
      return normalizeDateInput(input);
    },

    async resolveTaskInput(): Promise<Locator> {
      const taskPanel = await this.resolveTaskPanel();
      if (!taskPanel) throw new Error("could not locate goal task panel");

      const byPlaceholder = taskPanel.locator('input[placeholder*="Add" i], textarea[placeholder*="Add" i], input[placeholder*="task" i], textarea[placeholder*="task" i]').first();
      if ((await byPlaceholder.count()) > 0 && (await byPlaceholder.isVisible().catch(() => false))) return byPlaceholder;

      const byTextboxRole = taskPanel.getByRole("textbox").first();
      if ((await byTextboxRole.count()) > 0 && (await byTextboxRole.isVisible().catch(() => false))) {
        const placeholder = ((await byTextboxRole.getAttribute("placeholder")) ?? "").toLowerCase();
        if (!placeholder.includes("type your message")) return byTextboxRole;
      }

      const byContentEditable = taskPanel.locator('[contenteditable="true"]').first();
      if ((await byContentEditable.count()) > 0 && (await byContentEditable.isVisible().catch(() => false))) return byContentEditable;

      const candidates = taskPanel.locator("textarea, input[type='text'], input:not([type])");
      const count = await candidates.count();
      for (let i = 0; i < count; i += 1) {
        const field = candidates.nth(i);
        const placeholder = (await field.getAttribute("placeholder")) ?? "";
        if (placeholder.toLowerCase().includes("type your message")) continue;
        return field;
      }

      throw new Error("could not locate task input");
    },

    async ensureTaskPanelVisible(): Promise<void> {
      const panel = await this.resolveTaskPanel();
      if (panel && (await panel.count()) > 0) return;
      const page = deps.pageOrThrow();
      const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      throw new StateError(`could not locate goal task panel (url=${page.url()} snippet=${snippet})`, {
        action: "inspect task panel anchors",
        detail: "task UI may have moved or stayed collapsed"
      });
    },

    async isTaskPanelVisible(): Promise<boolean> {
      const panel = await this.resolveTaskPanel();
      return Boolean(panel && (await panel.count()) > 0);
    },

    async waitForGoalContext(goalTitle?: string, timeoutMs = 2500): Promise<boolean> {
      const page = deps.pageOrThrow();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await this.isGoalContextOpen(goalTitle)) return true;
        await page.waitForTimeout(250);
      }
      return false;
    },

    async resolveTaskPanel(): Promise<Locator | null> {
      const page = deps.pageOrThrow();
      const candidates = [
        page.getByText(/How will you accomplish/i).first(),
        page.getByText(/Select Tasks/i).first(),
        page.getByText(/Add new task/i).first(),
        page.getByText(/Use the task suggestion tool/i).first()
      ];
      for (const anchor of candidates) {
        if ((await anchor.count()) === 0) continue;
        let best: Locator | null = null;
        let bestLength = -1;
        for (let depth = 1; depth <= 5; depth += 1) {
          const panel = anchor.locator(`xpath=ancestor::*[self::section or self::article or self::div][${depth}]`);
          if ((await panel.count()) === 0) continue;
          const text = ((await panel.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          if (/GOAL STATUS|CURRENT GOAL|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK|Type your message/i.test(text)) {
            continue;
          }
          if (!/How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(text)) {
            continue;
          }
          if (text.length > bestLength) {
            best = panel;
            bestLength = text.length;
          }
        }
        if (best) return best;
      }
      return null;
    },

    async resolveTaskRow(taskText: string): Promise<Locator> {
      const row = await this.resolveTaskRowWithinPanel(taskText);
      if (!row) throw new Error(`could not locate task row: ${taskText}`);
      return row;
    },

    async resolveTaskRowWithinPanel(taskText: string): Promise<Locator | null> {
      const panel = await this.resolveTaskPanel();
      if (!panel) return null;
      const normalized = normalizeTaskText(taskText);

      const exactText = panel.getByText(taskText, { exact: true }).first();
      if ((await exactText.count()) > 0) {
        return exactText.locator("xpath=ancestor::*[self::li or self::div or self::article or self::section][1]");
      }

      const exactRow = panel.locator("li, article, section, div").filter({ hasText: taskText }).first();
      if ((await exactRow.count()) > 0) {
        return exactRow;
      }

      const rows = panel.locator("li, article, section, div");
      const count = await rows.count();
      for (let i = 0; i < count; i += 1) {
        const row = rows.nth(i);
        const text = normalizeTaskText(await row.innerText().catch(() => ""));
        if (!text) continue;
        if (text === normalized || text.includes(normalized) || normalized.includes(text)) {
          return row;
        }
      }

      return null;
    },

    async resolveRowByText(text: string, required = true): Promise<Locator | null> {
      const page = deps.pageOrThrow();
      const node = page.getByText(text, { exact: false }).first();
      if ((await node.count()) === 0) {
        if (!required) return null;
        throw new Error(`could not locate text: ${text}`);
      }
      return node.locator("xpath=ancestor::*[self::div or self::li or self::article or self::section][1]");
    },

    async readVisibleTaskItems(): Promise<TaskItem[]> {
      const page = deps.pageOrThrow();
      const text = await page.locator("body").innerText().catch(() => "");
      return extractTaskItemsFromGoalPage(text);
    },

    async waitForTaskToAppear(taskText: string, timeoutMs = 2500): Promise<TaskItem | null> {
      const normalized = normalizeTaskText(taskText);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const tasks = await this.readVisibleTaskItems();
        const match = tasks.find((task) => {
          const candidate = normalizeTaskText(task.text);
          return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
        });
        if (match) return match;
        await deps.pageOrThrow().waitForTimeout(200);
      }
      return null;
    },

    async waitForTaskState(taskText: string, completed: boolean, timeoutMs = 2500): Promise<TaskItem | null> {
      const normalized = normalizeTaskText(taskText);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const tasks = await this.readVisibleTaskItems();
        const match = tasks.find((task) => {
          const candidate = normalizeTaskText(task.text);
          return (candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate)) && task.completed === completed;
        });
        if (match) return match;
        await deps.pageOrThrow().waitForTimeout(200);
      }
      return null;
    },

    async waitForTaskToDisappear(taskText: string, timeoutMs = 2500): Promise<boolean> {
      const normalized = normalizeTaskText(taskText);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const tasks = await this.readVisibleTaskItems();
        const stillPresent = tasks.some((task) => {
          const candidate = normalizeTaskText(task.text);
          return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
        });
        if (!stillPresent) return true;
        await deps.pageOrThrow().waitForTimeout(200);
      }
      return false;
    },

    async clickGoalCardAction(goalTitle: string, actionTexts: string[]): Promise<void> {
      const ok = await this.tryClickGoalCardAction(goalTitle, actionTexts);
      if (!ok) throw new Error(`could not execute goal action ${actionTexts.join("/")} for goal: ${goalTitle}`);
    },

    async tryClickStartInGoalsList(): Promise<boolean> {
      const page = deps.pageOrThrow();
      const yourGoals = page.getByText(/YOUR GOALS/i).first();
      if ((await yourGoals.count()) === 0) return false;
      const scope = yourGoals.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
      const startButton = scope.getByRole("button", { name: /^start$/i }).first();
      if ((await startButton.count()) > 0 && (await startButton.isVisible().catch(() => false))) {
        await startButton.scrollIntoViewIfNeeded().catch(() => undefined);
        await startButton.click({ timeout: 1500 }).catch(() => undefined);
        return true;
      }
      return deps.tryClickByText(page, ["START"], scope);
    },

    async tryOpenAnyGoalByLink(): Promise<boolean> {
      const page = deps.pageOrThrow();
      const goalIds = await this.listGoalIdsFromPage();
      if (goalIds.length > 0) {
        await this.openGoalContextById(goalIds[0]);
        return true;
      }
      const href = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((el) => el.getAttribute("href") || "")
          .filter((value) => /self-maximize\?goalId=|goalId=/.test(value));
        return links[0] || null;
      });
      if (!href) return false;
      const absolute = new URL(href, page.url()).toString();
      await page.goto(absolute, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      return true;
    },

    async openGoalContextById(goalId: string): Promise<void> {
      const page = deps.pageOrThrow();
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      await page.goto(`${base}/self-maximize?goalId=${encodeURIComponent(goalId)}`, { waitUntil: "domcontentloaded" });
    },

    async listGoalIdsFromPage(): Promise<string[]> {
      const page = deps.pageOrThrow();
      return page.evaluate(() => {
        const found = new Set<string>();
        const fromHref = (href: string | null): void => {
          if (!href) return;
          const match = href.match(/goalId=([A-Za-z0-9_-]+)/i);
          if (match?.[1]) found.add(match[1]);
        };
        for (const el of Array.from(document.querySelectorAll("a[href]"))) fromHref(el.getAttribute("href"));
        for (const el of Array.from(document.querySelectorAll("[data-goal-id], [data-goalid], [goalid]"))) {
          const value = el.getAttribute("data-goal-id") ?? el.getAttribute("data-goalid") ?? el.getAttribute("goalid") ?? "";
          if (/^[A-Za-z0-9_-]{8,}$/.test(value)) found.add(value);
        }
        const html = document.documentElement.innerHTML;
        for (const match of html.matchAll(/goalId=([A-Za-z0-9_-]+)/gi)) if (match[1]) found.add(match[1]);
        return [...found];
      });
    },

    async tryClickGoalCardAction(goalTitle: string, actionTexts: string[]): Promise<boolean> {
      const page = deps.pageOrThrow();
      const title = page.getByText(goalTitle, { exact: false }).first();
      if ((await title.count()) === 0) return false;
      const card = title.locator("xpath=ancestor::*[self::article or self::section or self::div][.//button or .//*[@role='button']][1]");
      return deps.tryClickByText(page, actionTexts, card);
    },

    goalIdFromUrl,

    titleCase,
  };
}

function normalizeTaskText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function taskDocCacheKey(goalId: string, taskText: string): string {
  return `${goalId}:${normalizeTaskText(taskText)}`;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function captureFirestoreAccessToken(page: Page): Promise<string> {
  const existing = await page.evaluate(() => document.body.innerText || "").catch(() => "");
  if (!existing) {
    await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  }

  return new Promise<string>(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off("request", onRequest);
      reject(new Error("timed out capturing firestore access token"));
    }, 8000);

    const onRequest = async (request: { url: () => string; postData: () => string | null; allHeaders?: () => Promise<Record<string, string>>; headers?: () => Record<string, string> }): Promise<void> => {
      const url = request.url();
      if (!/firestore\.googleapis\.com/i.test(url)) return;
      try {
        const asyncHeaders = typeof request.allHeaders === "function" ? await request.allHeaders() : undefined;
        const headers = asyncHeaders ?? (typeof request.headers === "function" ? request.headers() : {});
        const authHeader = headers.authorization ?? headers.Authorization;
        const authMatch = authHeader?.match(/^Bearer\s+([A-Za-z0-9._-]+)/i);
        if (authMatch?.[1]) {
          clearTimeout(timeout);
          page.off("request", onRequest);
          resolve(authMatch[1]);
          return;
        }
      } catch {
      }
      const body = request.postData() || "";
      const decoded = decodeURIComponent(body);
      const match = decoded.match(/Authorization:\s*Bearer\s+([A-Za-z0-9._-]+)/i);
      if (!match?.[1]) return;
      clearTimeout(timeout);
      page.off("request", onRequest);
      resolve(match[1]);
    };

    page.on("request", onRequest);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  });
}
