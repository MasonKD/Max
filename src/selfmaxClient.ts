import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { AtomicExecutor } from "./atomic.js";
import type {
  AuthState,
  GoalStatusBlock,
  GoalSummary,
  PrimitiveName,
  PrimitiveRequest,
  PrimitiveResponse,
  SessionContext,
  TaskItem
} from "./types.js";
import { actionById, knownActions, knownRoutes, type KnownActionId, type KnownRouteId } from "./catalog.js";
import { createReadPrimitiveHandlers } from "./primitives-read.js";
import { createWritePrimitiveHandlers } from "./primitives-write.js";
import { readPageSectionsDiagnostic, readRouteSnapshotDiagnostic, discoverLinksDiagnostic, readTaskPanelSnapshotDiagnostic, readBodySnippet } from "./diagnostics.js";
import { clickByText, extractRouteParams, goalIdFromUrl, matchKnownRoute, normalizeDateInput, resolveFirstVisible, titleCase, tryClickByCss, tryClickByText, waitForCondition, type SearchRoot } from "./navigation.js";
import { selectors, cssSelectors, textSelectors } from "./selectors.js";
import { AuthError, formatError, SelectorError, StateError } from "./recovery.js";
import {
  dedupeGoalSummaries,
  extractGoalStatusBlocks,
  extractGoalSummariesFromText,
  extractGoalTitleFromWorkspace,
  extractGoalsOverview,
  extractLifestormingCategory,
  extractLifestormingOverview,
  extractSensationPractice
} from "./extractors.js";

type DesireInput = {
  title: string;
  category?: string;
  dueDate?: string;
};

type SessionEntityCache = {
  goalsById: Record<
    string,
    {
      goalId: string;
      title?: string;
      category?: string;
      dueLabel?: string;
      progressLabel?: string;
      taskPanelState?: "tasks_present" | "add_tasks" | "empty";
      taskSummaryLabel?: string;
      taskPreviewItems?: string[];
      lastSeenAt: string;
    }
  >;
  desiresById: Record<
    string,
    {
      desireId: string;
      title?: string;
      category?: string;
      lastSeenAt: string;
    }
  >;
};

export class SelfMaxPlaywrightClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly atomic = new AtomicExecutor();
  private readonly entityCache: SessionEntityCache = { goalsById: {}, desiresById: {} };
  private readonly handlers = {
    ...createReadPrimitiveHandlers({
      login: () => this.login(),
      getState: (session) => this.getState(session),
      readAuthState: () => this.readAuthState(),
      readCurrentRoute: () => this.readCurrentRoute(),
      readKnownRoutes: () => this.readKnownRoutes(),
      readGoalsOverview: () => this.readGoalsOverview(),
      readRouteSnapshot: (route, url) => this.readRouteSnapshot(route, url),
      readPageSections: (route, url) => this.readPageSections(route, url),
      discoverLinks: (route, url) => this.discoverLinks(route, url),
      listGoals: (filter) => this.listGoals(filter),
      discoverGoals: (waitMs) => this.discoverGoals(waitMs),
      discoverGoalIds: (waitMs) => this.discoverGoalIds(waitMs),
      readGoal: (goalTitle, goalId) => this.readGoal(goalTitle, goalId),
      readGoalMetadata: (goalTitle, goalId) => this.readGoalMetadata(goalTitle, goalId),
      readGoalWorkspace: (goalTitle, goalId) => this.readGoalWorkspace(goalTitle, goalId),
      readGoalFull: (goalTitle, goalId) => this.readGoalFull(goalTitle, goalId),
      readCachedGoals: () => this.readCachedGoals(),
      readCachedDesires: () => this.readCachedDesires(),
      readTaskPanelSnapshot: (goalTitle, goalId) => this.readTaskPanelSnapshot(goalTitle, goalId),
      surveyActiveGoalTaskStates: () => this.surveyActiveGoalTaskStates(),
      listGoalTasks: (goalTitle, goalId) => this.listGoalTasks(goalTitle, goalId),
      readGoalChat: (goalTitle, goalId) => this.readGoalChat(goalTitle, goalId),
      readLifestormingOverview: () => this.readLifestormingOverview(),
      listLifestormingDesires: () => this.listLifestormingDesires(),
      readLifestormingCategory: (category) => this.readLifestormingCategory(category),
      readLifestormingFull: () => this.readLifestormingFull(),
      readSensationPractice: (desireId, desireTitle) => this.readSensationPractice(desireId, desireTitle),
      readCoachMessages: () => this.readCoachMessages(),
      listKnownActions: (route) => this.listKnownActions(route as KnownRouteId | null)
    }),
    ...createWritePrimitiveHandlers({
      setState: (session, patch) => this.setState(session, patch),
      talkToGuide: (message) => this.talkToGuide(message),
      talkToGoalChat: (message, goalTitle) => this.talkToGoalChat(message, goalTitle),
      sendCoachMessage: (message) => this.sendCoachMessage(message),
      brainstormDesiresForEachCategory: (items) => this.brainstormDesiresForEachCategory(items),
      feelOutDesires: (desires) => this.feelOutDesires(desires),
      createGoalsFromDesires: (desires) => this.createGoalsFromDesires(desires),
      createGoal: (input) => this.createGoal(input),
      startGoal: (goalTitle, goalId) => this.startGoal(goalTitle, goalId),
      addTasks: (goalTitle, goalId, tasks, useSuggestions) => this.addTasks(goalTitle, goalId, tasks, useSuggestions),
      removeTask: (goalTitle, goalId, taskText) => this.removeTask(goalTitle, goalId, taskText),
      completeTask: (goalTitle, goalId, taskText) => this.completeTask(goalTitle, goalId, taskText),
      uncompleteTask: (goalTitle, goalId, taskText) => this.uncompleteTask(goalTitle, goalId, taskText),
      completeGoal: (goalTitle, goalId) => this.completeGoal(goalTitle, goalId),
      archiveGoal: (goalTitle, goalId) => this.archiveGoal(goalTitle, goalId),
      deleteGoal: (goalTitle, goalId) => this.deleteGoal(goalTitle, goalId),
      deleteGoalApi: (goalId) => this.deleteGoalApi(goalId),
      navigate: (route) => this.navigate(route),
      invokeKnownAction: (payload) => this.invokeKnownAction(payload)
    })
  } satisfies Partial<Record<PrimitiveName, (req: PrimitiveRequest, session: SessionContext) => Promise<unknown>>>;

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.HEADLESS });
    const contextOptions = existsSync(config.SELFMAX_STORAGE_STATE_PATH)
      ? { storageState: config.SELFMAX_STORAGE_STATE_PATH }
      : undefined;
    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  async execute(req: PrimitiveRequest, session: SessionContext): Promise<PrimitiveResponse> {
    try {
      const result = await this.atomic.run(async () => {
        const handler = this.handlers[req.name];
        if (!handler) {
          throw new Error(`unsupported primitive: ${String(req.name)}`);
        }
        return handler(req, session);
      });

      return {
        id: req.id,
        ok: true,
        result
      };
    } catch (error) {
      return {
        id: req.id,
        ok: false,
        error: formatError(error)
      };
    }
  }

  private assertUnreachable(value: never): never {
    throw new Error(`unsupported primitive: ${String(value)}`);
  }

  private ensurePage(): Page {
    if (!this.page) {
      throw new Error("playwright client not initialized");
    }
    return this.page;
  }

  private asOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async login(): Promise<{ loggedIn: boolean; url: string }> {
    const page = this.ensurePage();
    const authUrl = `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/auth?mode=sign-in&v=b`;
    const goalsUrl = `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`;
    let lastError: Error | null = null;

    await page.goto(goalsUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    if (await this.isGoalsWorkspaceVisible()) {
      await this.persistAuthState();
      return { loggedIn: true, url: page.url() };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto(authUrl, { waitUntil: "domcontentloaded" });

        const emailInput = await this.resolveFirstVisible(page, [
          config.LOGIN_EMAIL_SELECTOR,
          ...cssSelectors(selectors.auth.emailInput)
        ]);
        await emailInput.fill(config.SELFMAX_EMAIL);

        const passwordInput = await this.resolveFirstVisible(page, [
          config.LOGIN_PASSWORD_SELECTOR,
          ...cssSelectors(selectors.auth.passwordInput)
        ]);
        await passwordInput.fill(config.SELFMAX_PASSWORD);

        const exactSignIn = page.getByRole("button", { name: /^sign in$/i }).first();
        let submitted = false;
        if ((await exactSignIn.count()) > 0 && (await exactSignIn.isVisible().catch(() => false))) {
          await exactSignIn.click({ timeout: 1500 });
          submitted = true;
        }
        if (!submitted) {
          submitted = await this.tryClickByCss(page, [config.LOGIN_SUBMIT_SELECTOR, ...cssSelectors(selectors.auth.submitButtons)]);
        }
        if (!submitted) {
          throw new AuthError("could not submit login form", {
            action: "inspect auth selectors",
            detail: "submit button did not match primary or fallback selectors"
          });
        }

        await Promise.race([
          page.waitForURL(/\/goals(\?|$)/, { timeout: 15000 }),
          page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        ]).catch(() => undefined);

        if (/\/auth(\?|$)/.test(page.url())) {
          await passwordInput.press("Enter").catch(() => undefined);
          if (await this.tryClickByCss(page, ['button[type=\"submit\"]'])) {
            await Promise.race([
              page.waitForURL(/\/goals(\?|$)/, { timeout: 10000 }),
              page.waitForLoadState("domcontentloaded", { timeout: 10000 })
            ]).catch(() => undefined);
          }
        }

        let reachedGoals = false;
        for (let i = 0; i < 4; i += 1) {
          await page.goto(goalsUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
          try {
            await this.ensureGoalsWorkspaceVisible();
            reachedGoals = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            await page.waitForTimeout(1500);
          }
        }

        if (reachedGoals) {
          await this.persistAuthState();
          return { loggedIn: true, url: page.url() };
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      await page.waitForTimeout(1500);
    }

    throw lastError ?? new AuthError("login failed after retries", {
      action: "re-authenticate in a long-lived session",
      detail: "storage state did not restore a valid goals workspace"
    });
  }

  private async setState(session: SessionContext, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const page = this.ensurePage();
    const key = this.storageKeyFor(session);

    const updated = await page.evaluate(
      ({ storageKey, incoming }) => {
        const currentRaw = window.localStorage.getItem(storageKey);
        const current = currentRaw ? JSON.parse(currentRaw) : {};
        const next = {
          ...current,
          ...incoming,
          updatedAt: new Date().toISOString()
        };
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      },
      { storageKey: key, incoming: patch }
    );

    return updated;
  }

  private async getState(session: SessionContext): Promise<Record<string, unknown>> {
    const page = this.ensurePage();
    const key = this.storageKeyFor(session);

    const state = await page.evaluate((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    }, key);

    return state;
  }

  private async talkToGuide(message: string): Promise<{ sent: boolean }> {
    await this.ensureOnGoals();
    return this.sendCoachMessage(message);
  }

  private async talkToGoalChat(message: string, goalTitle?: string): Promise<{ sent: boolean; goalTitle?: string }> {
    if (goalTitle) {
      await this.openGoalContext(goalTitle);
    } else {
      await this.ensureOnGoals();
    }
    await this.sendCoachMessage(message);
    return { sent: true, goalTitle };
  }

  private async sendCoachMessage(message: string): Promise<{ sent: boolean }> {
    if (!message.trim()) {
      throw new Error("message is required");
    }

    const input = await this.resolveChatInput();
    await input.fill(message);

    const sent = await this.tryClickByText(this.pageOrThrow(), ["Send", "GO", "submit"], input.locator("xpath=ancestor::*[self::form or self::div][1]"));
    if (!sent) {
      await input.press("Meta+Enter");
    }

    return { sent: true };
  }

  private async readCoachMessages(): Promise<string[]> {
    const page = this.ensurePage();

    const byConfiguredSelector = page.locator(config.COACH_MESSAGE_SELECTOR);
    if ((await byConfiguredSelector.count()) > 0) {
      return byConfiguredSelector
        .allTextContents()
        .then((messages) => messages.map((m) => m.trim()).filter((m) => m.length > 0));
    }

    const generic = page.locator('[class*="message"], [data-role*="message"], [data-testid*="message"]');
    if ((await generic.count()) === 0) {
      return [];
    }

    const messages = await generic.allTextContents();
    return messages.map((m) => m.trim()).filter((m) => m.length > 0);
  }

  private async brainstormDesiresForEachCategory(
    itemsByCategory: Record<string, unknown>
  ): Promise<{ categoriesUpdated: string[]; itemsAdded: number }> {
    const page = this.ensurePage();
    await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming/desires-selection/category`, {
      waitUntil: "domcontentloaded"
    });

    let added = 0;
    const categories = Object.keys(itemsByCategory);

    for (const category of categories) {
      await this.clickByText(page, [category.toUpperCase(), this.titleCase(category)]);
      const rawItems = itemsByCategory[category];
      const items = Array.isArray(rawItems) ? rawItems.map((v) => String(v)).filter((v) => v.trim().length > 0) : [];

      for (const item of items) {
        const field = await this.resolveDesireInput();
        await field.fill(item);
        const clicked = await this.tryClickByText(page, ["Add", "ADD"]);
        if (!clicked) {
          await field.press("Enter");
        }
        added += 1;
      }
    }

    return { categoriesUpdated: categories, itemsAdded: added };
  }

  private async feelOutDesires(rawDesires: unknown[]): Promise<{ processed: string[] }> {
    const page = this.ensurePage();
    const desires = rawDesires.map((v) => String(v)).filter((v) => v.trim().length > 0);
    const processed: string[] = [];

    for (const desire of desires) {
      await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });
      await this.openDesireForViewing(desire);

      const notes = page.locator("textarea").filter({ hasNotText: "Type your message" }).first();
      if ((await notes.count()) > 0) {
        const noteText = `Resonance check for ${desire}: feels actionable and meaningful.`;
        await notes.fill(noteText);
      }
      await this.tryClickByText(page, ["SAVE", "Save"]);
      processed.push(desire);
    }

    return { processed };
  }

  private async createGoalsFromDesires(rawDesires: unknown[]): Promise<{ created: string[] }> {
    const desires = rawDesires
      .map((entry) => {
        if (typeof entry === "string") {
          return { title: entry } as DesireInput;
        }
        if (typeof entry === "object" && entry !== null) {
          const obj = entry as Record<string, unknown>;
          return {
            title: String(obj.title ?? ""),
            category: this.asOptionalString(obj.category),
            dueDate: this.asOptionalString(obj.dueDate)
          } as DesireInput;
        }
        return { title: "" } as DesireInput;
      })
      .filter((entry) => entry.title.trim().length > 0);

    const created: string[] = [];

    for (const desire of desires) {
      const promoted = await this.tryPromoteDesireToGoal(desire.title);
      if (!promoted) {
        await this.createGoal(desire);
      }
      created.push(desire.title);
    }

    return { created };
  }

  private async createGoal(input: DesireInput): Promise<{ created: boolean; title: string }> {
    const page = this.ensurePage();
    if (!input.title.trim()) {
      throw new Error("create_goal requires title");
    }

    await this.ensureOnGoals();
    const activeBefore = await this.readGoalCount("Active");
    const opened = await this.tryClickByText(page, [
      "NEW GOAL",
      "(I KNOW WHAT MY GOAL IS)",
      "I KNOW WHAT MY GOAL IS",
      "Create a New Goal"
    ]);
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

    const form = await this.resolveCreateGoalPanel();
    const titleField = await this.resolveGoalTitleInput(form ?? undefined);
    await titleField.fill(input.title);

    if (input.category) {
      const categorySet = await this.selectCreateGoalCategory(input.category);
      if (!categorySet) {
        throw new Error(`could not select create_goal category: ${input.category}`);
      }
    }

    if (input.dueDate) {
      const due = (form ?? page).locator('input[type="date"]').first();
      if ((await due.count()) > 0) {
        const normalized = this.normalizeDateInput(input.dueDate);
        if (normalized) {
          await due.fill(normalized);
        }
      }
    }

    let submitted = false;
    const createResponsePromise = page
      .waitForResponse((res) => res.request().method() === "POST" && /\/goals(\?|$)/.test(res.url()), { timeout: 10000 })
      .catch(() => null);
    const createBtn = page.getByRole("button", { name: /^create goal$/i }).first();
    if ((await createBtn.count()) > 0 && (await createBtn.isVisible().catch(() => false))) {
      try {
        await createBtn.click({ timeout: 2000 });
        submitted = true;
      } catch {
        submitted = false;
      }
    }
    if (!submitted) {
      submitted = await this.tryClickByText(form ?? page, ["Create Goal", "Create", "Save", "Add Goal", "Done"]);
    }
    if (!submitted) {
      const domClicked = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (el) => (el.textContent || "").trim().toLowerCase() === "create goal"
        ) as HTMLButtonElement | undefined;
        if (!button) {
          return false;
        }
        button.click();
        return true;
      });
      submitted = domClicked;
    }
    if (!submitted) {
      await titleField.press("Enter");
    }

    const deadline = Date.now() + 10000;
    let serverError: string | null = null;
    const createResponse = await createResponsePromise;
    if (createResponse) {
      try {
        const raw = await createResponse.text();
        const match = raw.match(/"success":false,"error":"([^"]+)"/);
        if (match?.[1]) {
          serverError = match[1];
        }
      } catch {
        serverError = null;
      }
    }

    while (Date.now() < deadline) {
      if (await this.isGoalContextOpen(input.title)) {
        return { created: true, title: input.title };
      }
      await this.ensureOnGoals();
      const activeAfter = await this.readGoalCount("Active");
      if (activeBefore !== null && activeAfter !== null && activeAfter > activeBefore) {
        return { created: true, title: input.title };
      }
      await page.waitForTimeout(300);
    }
    const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    if (serverError) {
      throw new Error(`create_goal failed: ${serverError}`);
    }
    throw new Error(
      `create_goal submission did not increase active goal count (before=${activeBefore} title=${input.title} snippet=${snippet})`
    );

  }

  private async readGoalsOverview(): Promise<{
    url: string;
    auth: AuthState;
    guidePrompt?: string;
    filterCounts: Record<string, number>;
    categoryCounts: Array<{ category: string; count: number }>;
    visibleGoals: string[];
    snippet: string;
  }> {
    const page = this.pageOrThrow();
    await this.ensureOnGoals();
    const auth = await this.readAuthState();

    const text = await page.locator("body").innerText().catch(() => "");
    const result = extractGoalsOverview(text);

    return { url: page.url(), auth, ...result };
  }

  private async readAuthState(): Promise<AuthState> {
    const archivedCount = await this.readGoalCount("Archived");
    const activeCount = await this.readGoalCount("Active");
    const completeCount = await this.readGoalCount("Complete");
    const allCount = await this.readGoalCount("All");
    return {
      valid: await this.isGoalsWorkspaceVisible(),
      archivedCount,
      activeCount,
      completeCount,
      allCount
    };
  }

  private async readCurrentRoute(): Promise<{
    url: string;
    routeId?: KnownRouteId;
    params: Record<string, string>;
  }> {
    const page = this.pageOrThrow();
    const url = page.url();
    return {
      url,
      routeId: matchKnownRoute(url),
      params: extractRouteParams(url)
    };
  }

  private async readKnownRoutes(): Promise<typeof knownRoutes> {
    return knownRoutes;
  }

  private async readRouteSnapshot(
    route?: string,
    explicitUrl?: string
  ): Promise<{
    url: string;
    auth?: AuthState;
    headingCandidates: string[];
    buttonTexts: string[];
    inputPlaceholders: string[];
    snippet: string;
  }> {
    const page = this.pageOrThrow();
    if (explicitUrl) {
      await page.goto(explicitUrl, { waitUntil: "domcontentloaded" });
    } else if (route) {
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      const path = route.startsWith("/") ? route : `/${route}`;
      await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    }
    const onGoals = /\/goals(\?|$)/.test(page.url());
    return readRouteSnapshotDiagnostic(page, onGoals ? await this.readAuthState() : undefined);
  }

  private async readPageSections(
    route?: string,
    explicitUrl?: string
  ): Promise<{
    url: string;
    routeId?: KnownRouteId;
    title?: string;
    headings: string[];
    paragraphs: string[];
    formLabels: string[];
    buttons: string[];
    links: Array<{ text: string; href: string }>;
    snippet: string;
  }> {
    const page = this.pageOrThrow();
    await this.navigateForRead(route, explicitUrl);
    return readPageSectionsDiagnostic(page);
  }

  private async discoverLinks(
    route?: string,
    explicitUrl?: string
  ): Promise<{
    url: string;
    routeId?: KnownRouteId;
    links: Array<{ text: string; href: string; routeId?: KnownRouteId }>;
  }> {
    const page = this.pageOrThrow();
    await this.navigateForRead(route, explicitUrl);
    return discoverLinksDiagnostic(page);
  }

  private async listGoals(filter: string): Promise<{
    filter: string;
    auth: AuthState;
    goals: GoalSummary[];
  }> {
    const page = this.pageOrThrow();
    await this.ensureOnGoals();
    const auth = await this.readAuthState();

    const normalized = filter.trim().toLowerCase();
    if (normalized === "active") {
      await this.tryClickByText(page, ["Active"]);
    } else if (normalized === "complete") {
      await this.tryClickByText(page, ["Complete"]);
    } else if (normalized === "archived") {
      await this.tryClickByText(page, ["Archived"]);
    } else {
      await this.tryClickByText(page, ["All"]);
    }

    const goals = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("article, section, li, div"));
      const extracted: GoalSummary[] = [];
      const categories = ["health", "work", "love", "family", "social", "fun", "dreams", "meaning"];

      for (const row of rows) {
        const text = (row.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || !/start|tasks completed|due/i.test(text)) {
          continue;
        }
        const lines = (row.textContent || "")
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const title =
          lines.find(
            (line) =>
              !/start|view|archive|complete|due|tasks completed|meaning|health|work|love|family|social|fun|dreams/i.test(line)
          ) ?? "";
        if (!title || title.length < 2) {
          continue;
        }

        const html = row.outerHTML;
        const idMatch = html.match(/goalId=([A-Za-z0-9_-]+)/i) ?? html.match(/data-goal-id=["']?([A-Za-z0-9_-]+)/i);
        const category = lines.find((line) => categories.includes(line.toLowerCase()));
        const dueLabel = lines.find((line) => /^Due\s/i.test(line));
        const progressLabel = lines.find((line) => /tasks completed|\d+%/i.test(line));
        const summaryIndex = lines.findIndex((line) => /tasks completed|No tasks/i.test(line));
        const taskSummaryLabel = summaryIndex !== -1 ? lines[summaryIndex] : undefined;
        const taskPreviewItems = lines
          .filter(
            (line) =>
              line !== title &&
              line !== category &&
              line !== dueLabel &&
              line !== progressLabel &&
              line !== taskSummaryLabel &&
              !/^(START|ADD TASKS)$/i.test(line) &&
              line.length > 0
          )
          .slice(0, 12);
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
      for (const item of goals) {
        merged.set(item.title, item);
      }
      for (const summary of summaryGoals) {
        const existing = merged.get(summary.title);
        merged.set(summary.title, {
          ...existing,
          ...summary,
          goalId: existing?.goalId
        });
      }
      extractedGoals = dedupeGoalSummaries([...merged.values()]);
    } else if (extractedGoals.length === 0) {
      extractedGoals = summaryGoals;
    }

    for (const goal of extractedGoals) {
      const resolvedGoalId = goal.goalId ?? this.findGoalIdByTitle(goal.title);
      if (resolvedGoalId) {
        this.cacheGoal({
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
  }

  private async surveyActiveGoalTaskStates(): Promise<{
    goals: Array<{
      title: string;
      goalId?: string;
      category?: string;
      progressLabel?: string;
      taskSummaryLabel?: string;
      taskPreviewItems?: string[];
      taskPanelState?: "tasks_present" | "add_tasks" | "empty";
    }>;
    counts: { tasks_present: number; add_tasks: number; empty: number };
  }> {
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
    for (const goal of goals) {
      counts[goal.taskPanelState] += 1;
    }
    return { goals, counts };
  }

  private async getGoalTaskSummary(
    goalTitle?: string,
    goalId?: string
  ): Promise<
    | {
        goalId?: string;
        title: string;
        taskPanelState: "tasks_present" | "add_tasks" | "empty";
        taskSummaryLabel?: string;
        taskPreviewItems?: string[];
      }
    | null
  > {
    if (goalId) {
      const cached = this.entityCache.goalsById[goalId];
      if (cached?.taskPanelState) {
        return {
          goalId,
          title: cached.title ?? goalTitle ?? goalId,
          taskPanelState: cached.taskPanelState,
          taskSummaryLabel: cached.taskSummaryLabel,
          taskPreviewItems: cached.taskPreviewItems
        };
      }
    }

    const listed = await this.listGoals("active");
    const resolvedTitle = goalTitle ?? (goalId ? this.entityCache.goalsById[goalId]?.title : undefined);
    const match = listed.goals.find((goal) => (goalId && goal.goalId === goalId) || (resolvedTitle && goal.title === resolvedTitle));
    if (!match) {
      return null;
    }
    return {
      goalId: match.goalId ?? this.findGoalIdByTitle(match.title),
      title: match.title,
      taskPanelState: match.taskPanelState ?? "empty",
      taskSummaryLabel: match.taskSummaryLabel,
      taskPreviewItems: match.taskPreviewItems
    };
  }

  private async discoverGoalIds(waitMs?: unknown): Promise<{ goalIds: string[]; waitMs: number; loadingVisible: boolean }> {
    const page = this.pageOrThrow();
    await this.ensureOnGoals();
    const wait = typeof waitMs === "number" && Number.isFinite(waitMs) ? Math.max(0, Math.min(waitMs, 30000)) : 4000;

    const chunks: string[] = [];
    const onResponse = async (res: { url: () => string; text: () => Promise<string> }): Promise<void> => {
      const url = res.url();
      if (!/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/i.test(url)) {
        return;
      }
      try {
        const text = await res.text();
        if (text) {
          chunks.push(text.slice(0, 200_000));
        }
      } catch {
        // ignore stream body read failures
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
    for (const match of source.matchAll(/documents\/goals\/([A-Za-z0-9_-]+)/g)) {
      if (match[1]) ids.add(match[1]);
    }
    for (const match of source.matchAll(/"goalId":"([A-Za-z0-9_-]+)"/g)) {
      if (match[1]) ids.add(match[1]);
    }
    for (const match of source.matchAll(/goalId=([A-Za-z0-9_-]+)/g)) {
      if (match[1]) ids.add(match[1]);
    }

    const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    return { goalIds: [...ids], waitMs: wait, loadingVisible: /loading/i.test(bodyText) };
  }

  private async discoverGoals(waitMs?: unknown): Promise<{
    goals: Array<{ goalId: string; title?: string }>;
    sources: { domGoalIds: number; streamGoalIds: number };
    waitMs: number;
    loadingVisible: boolean;
  }> {
    const page = this.pageOrThrow();
    await this.ensureOnGoals();

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

    const stream = await this.discoverGoalIds(waitMs);
    const streamIds = stream.goalIds;
    const merged = new Map<string, { goalId: string; title?: string }>();
    for (const item of dom) {
      merged.set(item.goalId, item);
    }
    for (const id of streamIds) {
      if (!merged.has(id)) merged.set(id, { goalId: id });
    }

    if (merged.size === 0) {
      const listed = await this.listGoals("active");
      for (const goal of listed.goals) {
        try {
          await this.openGoalContext(goal.title);
          const resolvedId = this.goalIdFromUrl(this.pageOrThrow().url());
          if (resolvedId) {
            merged.set(resolvedId, { goalId: resolvedId, title: goal.title });
            this.cacheGoal({
              goalId: resolvedId,
              title: goal.title,
              category: goal.category,
              dueLabel: goal.dueLabel,
              progressLabel: goal.progressLabel
            });
          }
        } catch {
          // ignore per-goal discovery failures
        }
      }
      await this.ensureOnGoals();
    }

    return {
      goals: [...merged.values()],
      sources: { domGoalIds: dom.length, streamGoalIds: streamIds.length },
      waitMs: stream.waitMs,
      loadingVisible: stream.loadingVisible
    };
  }

  private async readGoal(
    goalTitle?: string,
    goalId?: string
  ): Promise<{
    goalId?: string;
    goalTitle?: string;
    url: string;
    workspaceVisible: boolean;
    snippet: string;
    statusBlocks: Array<{ name: string; state: string; prompts: string[] }>;
  }> {
    await this.openGoalForRead(goalTitle, goalId);
    const page = this.pageOrThrow();
    const workspaceVisible = await this.isGoalWorkspaceVisible();
    const snippet = await this.readBodySnippet();

    const text = await page.locator("body").innerText().catch(() => "");
    const snapshot = {
      url: page.url(),
      title: extractGoalTitleFromWorkspace(text),
      statusBlocks: extractGoalStatusBlocks(text)
    };

    const resolvedGoalId = goalId ?? goalIdFromUrl(snapshot.url);
    const resolvedGoalTitle = goalTitle ?? (snapshot.title || undefined);
    if (resolvedGoalId) {
      this.cacheGoal({ goalId: resolvedGoalId, title: resolvedGoalTitle });
    }

    return {
      goalId: resolvedGoalId,
      goalTitle: resolvedGoalTitle,
      url: snapshot.url,
      workspaceVisible,
      snippet,
      statusBlocks: snapshot.statusBlocks
    };
  }

  private async readGoalMetadata(
    goalTitle?: string,
    goalId?: string
  ): Promise<{
    goalId?: string;
    goalTitle?: string;
    url: string;
    workspaceVisible: boolean;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
    snippet: string;
  }> {
    await this.openGoalForRead(goalTitle, goalId);
    const page = this.pageOrThrow();
    const result = await page.evaluate(() => {
      const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
      const currentGoalIndex = lines.findIndex((line) => /Current Goal/i.test(line));
      const currentGoal = currentGoalIndex !== -1 ? lines[currentGoalIndex + 1] || "" : "";
      const categories = ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"];
      const category = lines.find((line) => categories.includes(line)) || "";
      const dueLabel = lines.find((line) => /^Due\s/i.test(line)) || "";
      const progressLabel = lines.find((line) => /\d+\/\d+\s+tasks completed|\d+%/i.test(line)) || "";
      return {
        currentGoal,
        category,
        dueLabel,
        progressLabel,
        snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
      };
    });

    const resolvedGoalId = goalId ?? goalIdFromUrl(page.url());
    const resolvedGoalTitle = goalTitle ?? (result.currentGoal || undefined);
    if (resolvedGoalId) {
      this.cacheGoal({
        goalId: resolvedGoalId,
        title: resolvedGoalTitle,
        category: result.category || undefined,
        dueLabel: result.dueLabel || undefined,
        progressLabel: result.progressLabel || undefined
      });
    }

    return {
      goalId: resolvedGoalId,
      goalTitle: resolvedGoalTitle,
      url: page.url(),
      workspaceVisible: await this.isGoalWorkspaceVisible(),
      category: result.category || undefined,
      dueLabel: result.dueLabel || undefined,
      progressLabel: result.progressLabel || undefined,
      snippet: result.snippet
    };
  }

  private async readGoalFull(
    goalTitle?: string,
    goalId?: string
  ): Promise<{
    goalId?: string;
    goalTitle?: string;
    url: string;
    workspaceVisible: boolean;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
      statusBlocks: GoalStatusBlock[];
    messages: string[];
      tasks: TaskItem[];
    taskReadReason?: string;
    snippet: string;
  }> {
    const goal = await this.readGoal(goalTitle, goalId);
    const metadata = await this.readGoalMetadata(goalTitle, goalId);
    const chat = await this.readGoalChat(goalTitle, goalId);
    const tasks = await this.listGoalTasks(goalTitle, goalId);

    const resolvedGoalId = goal.goalId ?? metadata.goalId ?? chat.goalId ?? tasks.goalId;
    const resolvedGoalTitle = goal.goalTitle ?? metadata.goalTitle ?? chat.goalTitle ?? tasks.goalTitle;
    if (resolvedGoalId) {
      this.cacheGoal({
        goalId: resolvedGoalId,
        title: resolvedGoalTitle,
        category: metadata.category,
        dueLabel: metadata.dueLabel,
        progressLabel: metadata.progressLabel
      });
    }

    return {
      goalId: resolvedGoalId,
      goalTitle: resolvedGoalTitle,
      url: goal.url,
      workspaceVisible: goal.workspaceVisible && metadata.workspaceVisible,
      category: metadata.category,
      dueLabel: metadata.dueLabel,
      progressLabel: metadata.progressLabel,
      statusBlocks: goal.statusBlocks,
      messages: chat.messages,
      tasks: tasks.tasks,
      taskReadReason: tasks.reason,
      snippet: goal.snippet
    };
  }

  private async readCachedGoals(): Promise<{ goals: Array<SessionEntityCache["goalsById"][string]> }> {
    return {
      goals: Object.values(this.entityCache.goalsById).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    };
  }

  private async readCachedDesires(): Promise<{ desires: Array<SessionEntityCache["desiresById"][string]> }> {
    return {
      desires: Object.values(this.entityCache.desiresById).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    };
  }

  private async readTaskPanelSnapshot(
    goalTitle?: string,
    goalId?: string
  ): Promise<{
    goalId?: string;
    goalTitle?: string;
    url: string;
    taskPanelVisible: boolean;
    taskPanelText?: string;
    nearbyTexts: string[];
    nearbyHtml: string[];
    snippet: string;
  }> {
    await this.openGoalForRead(goalTitle, goalId);
    const page = this.pageOrThrow();
    await this.openTaskPanel();
    const panel = await this.resolveTaskPanel();
    const taskPanelVisible = Boolean(panel && (await panel.count()) > 0);
    const result = await readTaskPanelSnapshotDiagnostic(
      page,
      panel ? ((await panel.innerText().catch(() => "")).replace(/\s+/g, " ").trim() || undefined) : undefined,
      taskPanelVisible
    );

    return {
      goalId: goalId ?? goalIdFromUrl(page.url()),
      goalTitle,
      ...result
    };
  }

  private async readGoalWorkspace(
    goalTitle?: string,
    goalId?: string
  ): Promise<{
    goalId?: string;
    goalTitle?: string;
    url: string;
    workspaceVisible: boolean;
    tabs: string[];
    currentGoal?: string;
    snippet: string;
  }> {
    await this.openGoalForRead(goalTitle, goalId);
    const page = this.pageOrThrow();

    const result = await page.evaluate(() => {
      const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
      const tabs = lines.filter((line) => /^(BACK|EDIT|TASKS)$/i.test(line));
      const idx = lines.findIndex((line) => /Current Goal/i.test(line));
      const currentGoal = idx !== -1 ? lines[idx + 1] || "" : "";
      return {
        tabs,
        currentGoal,
        snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
      };
    });

    return {
      goalId: goalId ?? this.goalIdFromUrl(page.url()),
      goalTitle: goalTitle ?? (result.currentGoal || undefined),
      url: page.url(),
      workspaceVisible: await this.isGoalWorkspaceVisible(),
      tabs: result.tabs,
      currentGoal: result.currentGoal || undefined,
      snippet: result.snippet
    };
  }

  private async listGoalTasks(
    goalTitle?: string,
    goalId?: string
  ): Promise<{
    goalId?: string;
    goalTitle?: string;
    url: string;
    workspaceVisible: boolean;
    reason?: string;
    snippet?: string;
    tasks: Array<{ text: string; completed: boolean }>;
  }> {
    const summary = await this.getGoalTaskSummary(goalTitle, goalId);
    if (summary?.taskPanelState === "add_tasks") {
      return {
        goalId: goalId ?? summary.goalId,
        goalTitle: goalTitle ?? summary.title,
        url: this.pageOrThrow().url(),
        workspaceVisible: false,
        reason: summary.taskSummaryLabel ?? "No tasks",
        snippet: await this.readBodySnippet().catch(() => ""),
        tasks: []
      };
    }
    if (summary?.taskPanelState === "tasks_present" && (summary.taskPreviewItems?.length ?? 0) > 0) {
      return {
        goalId: goalId ?? summary.goalId,
        goalTitle: goalTitle ?? summary.title,
        url: this.pageOrThrow().url(),
        workspaceVisible: false,
        reason: summary.taskSummaryLabel,
        snippet: await this.readBodySnippet().catch(() => ""),
        tasks: summary.taskPreviewItems!.map((text) => ({ text, completed: false }))
      };
    }

    await this.openGoalForRead(goalTitle, goalId);
    const page = this.pageOrThrow();
    try {
      await this.ensureOnGoalTaskContext(undefined);
    } catch (error) {
      return {
        goalId: goalId ?? this.goalIdFromUrl(page.url()),
        goalTitle,
        url: page.url(),
        workspaceVisible: await this.isGoalWorkspaceVisible(),
        reason: error instanceof Error ? error.message : String(error),
        snippet: await this.readBodySnippet(),
        tasks: []
      };
    }

    const taskPanelVisible = await this.isTaskPanelVisible();
    if (!taskPanelVisible) {
      return {
        goalId: goalId ?? this.goalIdFromUrl(page.url()),
        goalTitle,
        url: page.url(),
        workspaceVisible: await this.isGoalWorkspaceVisible(),
        reason: "task panel content not visible",
        snippet: await this.readBodySnippet(),
        tasks: []
      };
    }

    const tasks = await page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const noise = /^(Add new task|Use the task suggestion tool|Select Tasks|Cancel|Set Tasks|Type your message|⌘ \+ Enter to send|TASKS)$/i;
      const taskLike = (text: string): boolean =>
        /\b(research|discuss|reach out|plan|schedule|call|book|create|begin|talk|choose|review|write|set up|find|contact)\b/i.test(text) ||
        text.length > 18;

      const out: Array<{ text: string; completed: boolean }> = [];
      const panelAnchor = Array.from(document.querySelectorAll("body *")).find((el) =>
        /How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(normalize((el as HTMLElement).innerText || el.textContent || ""))
      );
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

      if (panelRoot) {
        collectFromScope(panelRoot);
      }

      const lines = (document.body.innerText || "").split(/\n+/).map(normalize).filter(Boolean);
      const start = lines.findIndex((line) => /How will you accomplish/i.test(line));
      if (start !== -1) {
        for (let i = start + 1; i < lines.length; i += 1) {
          const line = lines[i];
          if (noise.test(line) || /Tasks are generated based/i.test(line)) break;
          if (/Current Goal|GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK/i.test(line)) continue;
          if (taskLike(line)) {
            out.push({ text: line, completed: false });
          }
        }
      }

      const dedup = new Map<string, { text: string; completed: boolean }>();
      for (const item of out) {
        if (
          item.text.length > 3 &&
          !/SELF-IMPROVE|SELF-AWARENESS|COMMUNITY|CURRENT GOAL|GOAL STATUS|Not yet updated|What do you|Where can you|How are you thinking|What did you learn|Hello, I’m here to help/i.test(
            item.text
          ) &&
          !dedup.has(item.text)
        ) {
          dedup.set(item.text, item);
        }
      }
      return [...dedup.values()];
    });

    const resolvedGoalId = goalId ?? this.goalIdFromUrl(page.url());
    if (resolvedGoalId) {
      this.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
    }

    return {
      goalId: resolvedGoalId,
      goalTitle,
      url: page.url(),
      workspaceVisible: await this.isGoalWorkspaceVisible(),
      reason: tasks.length === 0 ? "no visible tasks extracted" : undefined,
      snippet: await this.readBodySnippet(),
      tasks
    };
  }

  private async readGoalChat(
    goalTitle?: string,
    goalId?: string
  ): Promise<{ goalId?: string; goalTitle?: string; url: string; messages: string[] }> {
    await this.openGoalForRead(goalTitle, goalId);
    await this.waitForGoalDataLoaded();
    const page = this.pageOrThrow();
    let messages = await this.readCoachMessages();
    if (messages.length === 0) {
      messages = await page.evaluate(() => {
        const lines = (document.body.innerText || "")
          .split(/\n+/)
          .map((v) => v.trim())
          .filter(Boolean);
        const idx = lines.findIndex((line) => /Type your message/i.test(line));
        if (idx <= 0) {
          return lines.filter((line) => /hello|help you|goal of|important to you|guide you/i.test(line)).slice(-8);
        }
        const out: string[] = [];
        for (let i = Math.max(0, idx - 12); i < idx; i += 1) {
          const line = lines[i];
          if (/GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK|CURRENT GOAL|BACK|EDIT|TASKS/i.test(line)) {
            continue;
          }
          if (line.length > 6) {
            out.push(line);
          }
        }
        return out;
      });
    }
    const resolvedGoalId = goalId ?? this.goalIdFromUrl(page.url());
    if (resolvedGoalId) {
      this.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
    }
    return {
      goalId: resolvedGoalId,
      goalTitle,
      url: page.url(),
      messages
    };
  }

  private async readLifestormingOverview(): Promise<{
    url: string;
    stepTexts: string[];
    visibleDesires: string[];
    desiresBySection: Array<{ section: "feel_it_out" | "start_a_goal"; items: string[] }>;
    snippet: string;
  }> {
    const page = this.pageOrThrow();
    const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
    await page.goto(`${base}/lifestorming`, { waitUntil: "domcontentloaded" });
    await this.waitForPageTextNotContaining("Loading Lifestorming Page...", 8000);
    const result = extractLifestormingOverview(await page.locator("body").innerText().catch(() => ""));

    for (const section of result.desiresBySection) {
      for (const title of section.items) {
        const existingId = this.findDesireIdByTitle(title);
        if (existingId) {
          this.cacheDesire({ desireId: existingId, title });
        }
      }
    }

    return { url: page.url(), ...result };
  }

  private async listLifestormingDesires(): Promise<{
    url: string;
    buckets: Array<{ category: string; items: string[] }>;
    snippet: string;
  }> {
    const overview = await this.readLifestormingOverview();
    const bySection = new Map(overview.desiresBySection.map((section) => [section.section, section.items]));
    return {
      url: overview.url,
      buckets: [
        { category: "feel_it_out", items: bySection.get("feel_it_out") ?? [] },
        { category: "start_a_goal", items: bySection.get("start_a_goal") ?? [] }
      ],
      snippet: overview.snippet
    };
  }

  private async readLifestormingCategory(
    category?: string
  ): Promise<{
    url: string;
    category?: string;
    intro?: string;
    items: string[];
    snippet: string;
  }> {
    const page = this.pageOrThrow();
    const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
    const targetUrl = `${base}/lifestorming/desires-selection/${(category ? category : "category").toLowerCase()}`;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await this.waitForPageTextNotContaining("Loading Desires...", 12000);
    if (category) {
      await this.waitForDesiresCategory(category);
    }

    const text = await page.locator("body").innerText().catch(() => "");
    const result = extractLifestormingCategory(text, new URL(page.url()).pathname);
    const anchors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/lifestorming/sensation-practice/"]')).map((el) => {
        const href = (el as HTMLAnchorElement).href || "";
        const match = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i);
        return { text: (el.textContent || "").trim(), desireId: match?.[1] };
      })
    );
    const normalizedCategory = result.category ? titleCase(result.category) : undefined;
    for (const item of result.items) {
      const linked = anchors.find((anchor) => anchor.text === item);
      if (linked?.desireId) {
        this.cacheDesire({ desireId: linked.desireId, title: item, category: normalizedCategory });
      }
    }

    return {
      url: page.url(),
      category: result.category,
      intro: result.intro,
      items: result.items,
      snippet: result.snippet
    };
  }

  private async readLifestormingFull(): Promise<{
    overview: {
      url: string;
      stepTexts: string[];
      visibleDesires: string[];
      desiresBySection: Array<{ section: "feel_it_out" | "start_a_goal"; items: string[] }>;
      snippet: string;
    };
    buckets: Array<{ category: string; items: string[] }>;
    categories: Array<{ category?: string; intro?: string; items: string[] }>;
    cachedDesires: Array<SessionEntityCache["desiresById"][string]>;
  }> {
    const overview = await this.readLifestormingOverview();
    const desires = await this.listLifestormingDesires();
    const categories: Array<{ category?: string; intro?: string; items: string[] }> = [];
    for (const category of ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"]) {
      categories.push(await this.readLifestormingCategory(category));
    }
    return {
      overview,
      buckets: desires.buckets,
      categories,
      cachedDesires: Object.values(this.entityCache.desiresById).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    };
  }

  private async readSensationPractice(
    desireId?: string,
    desireTitle?: string
  ): Promise<{
    desireId?: string;
    desireTitle?: string;
    category?: string;
    url: string;
    prompts: string[];
    actions: string[];
    snippet: string;
  }> {
    const page = this.pageOrThrow();
    const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");

    if (!desireId && desireTitle) {
      desireId = this.findDesireIdByTitle(desireTitle);
    }

    if (desireId) {
      await page.goto(`${base}/lifestorming/sensation-practice/${encodeURIComponent(desireId)}`, { waitUntil: "domcontentloaded" });
    } else if (desireTitle) {
      await page.goto(`${base}/lifestorming`, { waitUntil: "domcontentloaded" });
      await this.openDesireForViewing(desireTitle);
      desireId = this.extractRouteParams(page.url()).desireId;
    } else {
      throw new Error("read_sensation_practice requires desireId or desireTitle");
    }
    await this.waitForPageTextNotContaining("Loading...", 8000);

    const result = extractSensationPractice(await page.locator("body").innerText().catch(() => ""));

    const resolvedDesireId = desireId ?? extractRouteParams(page.url()).desireId;
    if (resolvedDesireId && result.title && !/Desire not found\.?/i.test(result.title)) {
      this.cacheDesire({
        desireId: resolvedDesireId,
        title: desireTitle ?? result.title,
        category: result.category
      });
    }

    return {
      desireId: resolvedDesireId,
      desireTitle: desireTitle ?? (result.title || undefined),
      category: result.category || undefined,
      url: page.url(),
      prompts: result.prompts,
      actions: result.actions,
      snippet: result.snippet
    };
  }

  private async startGoal(goalTitle?: string, goalId?: string): Promise<{ started: boolean; goalTitle?: string; goalId?: string }> {
    if (await this.isGoalContextOpen(goalTitle)) {
      return { started: true, goalTitle, goalId };
    }
    const page = this.pageOrThrow();
    if (goalId) {
      await this.openGoalContextById(goalId);
      if (await this.waitForGoalContext(goalTitle, 6000)) {
        return { started: true, goalTitle, goalId };
      }
      throw new Error(`could not open goal context for goalId: ${goalId}`);
    }

    await this.ensureOnGoals();
    if (!goalTitle) {
      const discoveredIds = await this.listGoalIdsFromPage();
      if (discoveredIds.length > 0) {
        await this.openGoalContextById(discoveredIds[0]);
        if (await this.waitForGoalContext(undefined, 6000)) {
          return { started: true, goalId: discoveredIds[0] };
        }
      }
      const streamIds = (await this.discoverGoalIds()).goalIds;
      if (streamIds.length > 0) {
        await this.openGoalContextById(streamIds[0]);
        if (await this.waitForGoalContext(undefined, 6000)) {
          return { started: true, goalId: streamIds[0] };
        }
      }

      let clicked =
        (await this.tryOpenAnyGoalByLink()) ||
        (await this.tryClickStartInGoalsList()) ||
        (await this.tryClickByText(page, ["START", "Start", "Open", "View"]));
      if (!clicked) {
        await this.tryClickByText(page, ["All"]);
        await this.tryClickByText(page, ["All"]);
        clicked =
          (await this.tryOpenAnyGoalByLink()) ||
          (await this.tryClickStartInGoalsList()) ||
          (await this.tryClickByText(page, ["START", "Start", "Open", "View"]));
      }
      if (!clicked) {
        throw new Error("could not locate any start action");
      }
      const opened = await this.waitForGoalContext(undefined, 6000);
      if (!opened) {
        throw new Error("start action did not open goal context");
      }
      return { started: true, goalId: this.goalIdFromUrl(this.pageOrThrow().url()) };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clicked = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
      if (!clicked) {
        await this.tryClickByText(page, ["All"]);
        const clickedAfterReset = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
        if (!clickedAfterReset) {
          await this.tryOpenAnyGoalByLink();
        }
      }
      if (await this.waitForGoalContext(goalTitle, 4000)) {
        return { started: true, goalTitle, goalId: this.goalIdFromUrl(this.pageOrThrow().url()) };
      }
      const byIds = await this.listGoalIdsFromPage();
      for (const id of byIds) {
        await this.openGoalContextById(id);
        if (await this.waitForGoalContext(goalTitle, 2500)) {
          return { started: true, goalTitle, goalId: id };
        }
      }
      await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }

    throw new Error(`could not execute goal action START/Start/Open/View for goal: ${goalTitle}`);
  }

  private async addTasks(
    goalTitle: string | undefined,
    goalId: string | undefined,
    tasks: string[],
    useSuggestions: boolean
  ): Promise<{ added: number; goalTitle?: string; usedSuggestions: boolean }> {
    const summary = await this.getGoalTaskSummary(goalTitle, goalId);
    if (summary?.taskPanelState === "empty") {
      throw new Error(`add_tasks refused: goal has no task entry point from /goals summary (${summary.title})`);
    }
    await this.ensureOnGoalTaskContext(goalTitle, goalId);
    const page = this.pageOrThrow();

    if (useSuggestions) {
      await this.clickByText(page, ["Use the task suggestion tool", "Select Tasks"]);
      for (const task of tasks) {
        await this.tryClickByText(page, [task]);
      }
      await this.tryClickByText(page, ["Set Tasks", "Add", "Save"]);
      return { added: tasks.length, goalTitle, usedSuggestions: true };
    }

    let added = 0;
    if (summary?.taskPanelState === "add_tasks") {
      await this.tryClickByText(page, ["ADD TASKS", "Add Tasks", "Use the task suggestion tool"]);
    }
    for (const task of tasks.filter((t) => t.trim().length > 0)) {
      await this.tryClickByText(page, ["Add new task", "Add task", "New task"]);
      const field = await this.resolveTaskInput();
      await field.fill(task);
      await field.press("Enter");
      added += 1;
    }

    return { added, goalTitle, usedSuggestions: false };
  }

  private async removeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string): Promise<{ removed: boolean }> {
    if (!taskText.trim()) {
      throw new Error("remove_task requires taskText");
    }
    const summary = await this.getGoalTaskSummary(goalTitle, goalId);
    if (summary?.taskPanelState !== "tasks_present") {
      throw new Error(`remove_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
    }
    await this.ensureOnGoalTaskContext(goalTitle, goalId);
    const row = await this.resolveTaskRow(taskText);

    const removed =
      (await this.tryClickByText(this.pageOrThrow(), ["Delete", "Remove", "Trash"], row)) ||
      (await this.tryClickByText(this.pageOrThrow(), ["×"], row));

    if (!removed) {
      throw new Error(`could not remove task: ${taskText}`);
    }

    return { removed: true };
  }

  private async completeTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string): Promise<{ completed: boolean }> {
    if (!taskText.trim()) {
      throw new Error("complete_task requires taskText");
    }
    const summary = await this.getGoalTaskSummary(goalTitle, goalId);
    if (summary?.taskPanelState !== "tasks_present") {
      throw new Error(`complete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
    }
    await this.ensureOnGoalTaskContext(goalTitle, goalId);
    const row = await this.resolveTaskRow(taskText);

    const checkbox = row.locator('input[type="checkbox"]').first();
    if ((await checkbox.count()) > 0) {
      if (!(await checkbox.isChecked())) {
        await checkbox.click();
      }
      return { completed: true };
    }

    const toggled = await this.tryClickByText(this.pageOrThrow(), ["Complete", "Mark complete", "Done"], row);
    if (!toggled) {
      throw new Error(`could not complete task: ${taskText}`);
    }

    return { completed: true };
  }

  private async uncompleteTask(goalTitle: string | undefined, goalId: string | undefined, taskText: string): Promise<{ uncompleted: boolean }> {
    if (!taskText.trim()) {
      throw new Error("uncomplete_task requires taskText");
    }
    const summary = await this.getGoalTaskSummary(goalTitle, goalId);
    if (summary?.taskPanelState !== "tasks_present") {
      throw new Error(`uncomplete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
    }
    await this.ensureOnGoalTaskContext(goalTitle, goalId);
    const row = await this.resolveTaskRow(taskText);

    const checkbox = row.locator('input[type="checkbox"]').first();
    if ((await checkbox.count()) > 0) {
      if (await checkbox.isChecked()) {
        await checkbox.click();
      }
      return { uncompleted: true };
    }

    const toggled = await this.tryClickByText(this.pageOrThrow(), ["Uncomplete", "Reopen", "Undo"], row);
    if (!toggled) {
      throw new Error(`could not uncomplete task: ${taskText}`);
    }

    return { uncompleted: true };
  }

  private async completeGoal(goalTitle?: string, goalId?: string): Promise<{ completed: boolean; goalTitle?: string; goalId?: string }> {
    await this.ensureOnGoals();

    if (goalId) {
      await this.openGoalContextById(goalId);
    } else if (goalTitle) {
      const clicked = await this.tryClickGoalCardAction(goalTitle, ["COMPLETE", "Complete", "Mark Complete"]);
      if (clicked) {
        return { completed: true, goalTitle, goalId };
      }
      await this.openGoalContext(goalTitle);
    }

    const page = this.pageOrThrow();
    await this.tryClickByText(page, ["EDIT", "Edit"]);
    const done = await this.tryClickByText(page, ["COMPLETE", "Complete", "Mark Complete"]);
    if (!done) {
      throw new Error("could not complete goal");
    }

    return { completed: true, goalTitle, goalId: goalId ?? this.goalIdFromUrl(this.pageOrThrow().url()) };
  }

  private async archiveGoal(goalTitle?: string, goalId?: string): Promise<{ archived: boolean; goalTitle?: string; goalId?: string }> {
    await this.ensureOnGoals();

    if (goalId) {
      await this.openGoalContextById(goalId);
    } else if (goalTitle) {
      const clicked = await this.tryClickGoalCardAction(goalTitle, ["ARCHIVE", "Archive"]);
      if (clicked) {
        return { archived: true, goalTitle, goalId };
      }
      await this.openGoalContext(goalTitle);
    }

    const page = this.pageOrThrow();
    await this.tryClickByText(page, ["EDIT", "Edit"]);
    const done = await this.tryClickByText(page, ["ARCHIVE", "Archive"]);
    if (!done) {
      throw new Error("could not archive goal");
    }

    return { archived: true, goalTitle, goalId: goalId ?? this.goalIdFromUrl(this.pageOrThrow().url()) };
  }

  private async deleteGoal(goalTitle?: string, goalId?: string): Promise<{ deleted: boolean; goalTitle?: string; goalId?: string }> {
    await this.ensureOnGoals();
    const page = this.pageOrThrow();

    if (goalId) {
      await this.openGoalContextById(goalId);
    } else if (goalTitle) {
      const clicked = await this.tryClickGoalCardAction(goalTitle, ["DELETE", "Delete", "Remove"]);
      if (clicked) {
        await this.tryClickByText(page, ["Delete", "Confirm", "Yes", "YES"]);
        return { deleted: true, goalTitle, goalId };
      }
      await this.openGoalContext(goalTitle);
    } else if (!page.url().includes("/self-maximize")) {
      await this.startGoal();
    }

    await this.tryClickByText(page, ["EDIT", "Edit"]);
    const deleted = await this.tryClickByText(page, ["DELETE GOAL", "Delete Goal", "DELETE", "Delete", "Remove"]);
    if (!deleted) {
      throw new Error("could not locate delete action for goal");
    }
    await this.tryClickByText(page, ["Delete", "Confirm", "Yes", "YES"]);
    return { deleted: true, goalTitle, goalId: goalId ?? this.goalIdFromUrl(page.url()) };
  }

  private async deleteGoalApi(goalId?: string): Promise<{ deleted: boolean; goalId: string; method: string }> {
    if (!goalId) {
      throw new Error("delete_goal_api requires payload.goalId");
    }
    const page = this.pageOrThrow();
    await this.ensureOnGoals();

    const result = await page.evaluate(async ({ id }) => {
      const global = window as unknown as Record<string, unknown>;

      // Best effort path: firebase SDK exposed globally by host app.
      const firebase = global.firebase as
        | {
            apps?: unknown[];
            firestore?: () => {
              collection: (name: string) => { doc: (docId: string) => { delete: () => Promise<void> } };
            };
          }
        | undefined;

      if (firebase?.firestore) {
        await firebase.firestore().collection("goals").doc(id).delete();
        return { ok: true, method: "firebase.firestore" };
      }

      return { ok: false, method: "unavailable" };
    }, { id: goalId });

    if (!result.ok) {
      throw new Error("delete_goal_api unavailable: firebase sdk is not exposed in this app context");
    }
    return { deleted: true, goalId, method: result.method };
  }

  private async navigate(route: KnownRouteId): Promise<{ route: KnownRouteId; url: string }> {
    const page = this.ensurePage();
    const url = knownRoutes[route];
    if (!url) {
      throw new Error(`unknown route: ${route}`);
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { route, url: page.url() };
  }

  private async navigateForRead(route?: string, explicitUrl?: string): Promise<void> {
    const page = this.pageOrThrow();
    if (explicitUrl) {
      await page.goto(explicitUrl, { waitUntil: "domcontentloaded" });
      return;
    }
    if (route && route in knownRoutes) {
      await this.navigate(route as KnownRouteId);
      return;
    }
    if (route) {
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      const path = route.startsWith("/") ? route : `/${route}`;
      await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    }
  }

  private async listKnownActions(route: KnownRouteId | null): Promise<typeof knownActions> {
    if (!route) {
      return [...knownActions];
    }
    return knownActions.filter((action) => action.route === route);
  }

  private matchKnownRoute(url: string): KnownRouteId | undefined {
    return matchKnownRoute(url);
  }

  private extractRouteParams(url: string): Record<string, string> {
    return extractRouteParams(url);
  }

  private async invokeKnownAction(payload: Record<string, unknown>): Promise<{ invoked: KnownActionId }> {
    const page = this.ensurePage();
    const actionId = payload.actionId as KnownActionId | undefined;
    if (!actionId) {
      throw new Error("payload.actionId is required");
    }

    const action = actionById.get(actionId);
    if (!action) {
      throw new Error(`unknown actionId: ${actionId}`);
    }

    const message = payload.message;
    if (typeof message === "string" && action.id === "goals.send_guide_message") {
      const input = await this.resolveChatInput();
      await input.fill(message);
    }

    await page.click(action.selector);
    return { invoked: action.id };
  }

  private pageOrThrow(): Page {
    return this.ensurePage();
  }

  private async ensureOnGoals(): Promise<void> {
    const page = this.pageOrThrow();
    if (page.url().includes("/goals") && (await this.isGoalsWorkspaceVisible())) {
      return;
    }
    await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" });
    await this.ensureGoalsWorkspaceVisible();
  }

  private async ensureOnGoalTaskContext(goalTitle?: string, goalId?: string): Promise<void> {
    if (goalId) {
      await this.openGoalContextById(goalId);
      await this.waitForGoalDataLoaded();
    } else if (goalTitle) {
      await this.openGoalContext(goalTitle);
    } else if (!this.pageOrThrow().url().includes("/self-maximize")) {
      await this.startGoal();
    }

    await this.openTaskPanel();
    await this.ensureTaskPanelVisible();
  }

  private async openTaskPanel(): Promise<void> {
    const page = this.pageOrThrow();
    const tabByRole = page.getByRole("button", { name: /^tasks$/i }).first();
    const attempts: Array<() => Promise<void>> = [
      async () => {
        if ((await tabByRole.count()) > 0 && (await tabByRole.isVisible().catch(() => false))) {
          await tabByRole.click({ timeout: 2000 }).catch(() => undefined);
        }
      },
      async () => {
        await this.tryClickByText(page, textSelectors(selectors.tasks.taskTab));
      },
      async () => {
        await this.tryClickByText(page, ["EDIT", "Edit"]);
        if ((await tabByRole.count()) > 0 && (await tabByRole.isVisible().catch(() => false))) {
          await tabByRole.click({ timeout: 2000 }).catch(() => undefined);
        } else {
          await this.tryClickByText(page, textSelectors(selectors.tasks.taskTab));
        }
      }
    ];

    for (const attempt of attempts) {
      await attempt();
      if (await this.waitForTaskPanelData(2500)) {
        return;
      }
    }
    throw new StateError("task panel did not open", {
      action: "inspect TASKS selector tiers",
      detail: "button click succeeded but no task panel anchor became visible"
    });
  }

  private async openGoalContext(goalTitle: string): Promise<void> {
    await this.ensureOnGoals();
    const page = this.pageOrThrow();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clicked = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
      if (!clicked) {
        await this.tryClickByText(page, ["All"]);
        const clickedAfterReset = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
        if (!clickedAfterReset) {
          await this.tryOpenAnyGoalByLink();
        }
      }
      if (await this.waitForGoalContext(goalTitle, 4000)) {
        return;
      }
      await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    throw new Error(`could not open goal context for: ${goalTitle}`);
  }

  private async openGoalForRead(goalTitle?: string, goalId?: string): Promise<void> {
    if (goalId) {
      await this.openGoalContextById(goalId);
      if (!(await this.waitForGoalContext(goalTitle, 6000))) {
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
    await this.startGoal();
    await this.waitForGoalDataLoaded();
  }

  private async isGoalWorkspaceVisible(): Promise<boolean> {
    const page = this.pageOrThrow();
    if (!/\/self-maximize(\?|$)/.test(page.url())) return false;
    const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    return /Current Goal|GOAL STATUS|Type your message|⌘ \+ Enter to send/i.test(bodyText);
  }

  private async readBodySnippet(): Promise<string> {
    return readBodySnippet(this.pageOrThrow());
  }

  private async waitForGoalDataLoaded(timeoutMs = 8000): Promise<void> {
    const page = this.pageOrThrow();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (!/Loading\.\.\.|Loading Goal/i.test(text) && /Current Goal|GOAL STATUS|Type your message|⌘ \+ Enter to send/i.test(text)) {
        return;
      }
      await page.waitForTimeout(250);
    }
  }

  private async waitForPageTextNotContaining(needle: string, timeoutMs = 8000): Promise<void> {
    const page = this.pageOrThrow();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (!text.includes(needle)) {
        return;
      }
      await page.waitForTimeout(250);
    }
  }

  private async waitForDesiresCategory(category: string, timeoutMs = 8000): Promise<void> {
    const page = this.pageOrThrow();
    const expected = category.trim().toUpperCase();
    const expectedPath = `/lifestorming/desires-selection/${category.trim().toLowerCase()}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const lines = (await page.locator("body").innerText().catch(() => ""))
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const bodyText = lines.join(" ");
      if (!/Loading Desires/i.test(bodyText) && (page.url().includes(expectedPath) || lines.includes(expected))) {
        return;
      }
      await page.waitForTimeout(250);
    }
  }

  private async waitForTaskPanelData(timeoutMs = 5000): Promise<boolean> {
    const page = this.pageOrThrow();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isTaskPanelVisible()) {
        return true;
      }
      const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (/How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(bodyText)) {
        return true;
      }
      await page.waitForTimeout(250);
    }
    return false;
  }

  private async isGoalContextOpen(goalTitle?: string): Promise<boolean> {
    const page = this.pageOrThrow();
    if (page.url().includes("/self-maximize")) {
      return true;
    }
    const currentGoal = page.getByText(/Current Goal/i).first();
    if ((await currentGoal.count()) === 0) {
      return false;
    }
    if (!goalTitle) {
      return true;
    }
    const goalText = page.getByText(goalTitle, { exact: false }).first();
    return (await goalText.count()) > 0;
  }

  private async openDesireForViewing(desire: string): Promise<void> {
    const page = this.pageOrThrow();
    const row = await this.resolveRowByText(desire);
    if (!row) {
      throw new Error(`could not locate desire row: ${desire}`);
    }
    const viewed =
      (await this.tryClickByText(page, ["VIEW", "GO", "Open"], row)) ||
      (await this.tryClickByText(page, [desire]));

    if (!viewed) {
      throw new Error(`could not open desire for feel-out: ${desire}`);
    }
  }

  private async tryPromoteDesireToGoal(desireTitle: string): Promise<boolean> {
    const page = this.pageOrThrow();
    await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });

    const row = await this.resolveRowByText(desireTitle, false);
    if (!row) {
      return false;
    }

    const promoted = await this.tryClickByText(page, ["ADD TO GOALS", "Add to goals"], row);
    if (!promoted) {
      return false;
    }

    return true;
  }

  private async resolveChatInput(): Promise<Locator> {
    const page = this.pageOrThrow();

    const byPlaceholder = page.getByPlaceholder("Type your message...").first();
    if ((await byPlaceholder.count()) > 0) {
      return byPlaceholder;
    }

    const byTextboxRoleNamed = page.getByRole("textbox", { name: /message|guide|chat/i }).first();
    if ((await byTextboxRoleNamed.count()) > 0) {
      return byTextboxRoleNamed;
    }

    const byAnyTextboxRole = page.getByRole("textbox").first();
    if ((await byAnyTextboxRole.count()) > 0) {
      return byAnyTextboxRole;
    }

    const byConfiguredSelector = page.locator(config.COACH_INPUT_SELECTOR).first();
    if ((await byConfiguredSelector.count()) > 0) {
      return byConfiguredSelector;
    }

    const byContentEditable = page.locator('[contenteditable=\"true\"]').first();
    if ((await byContentEditable.count()) > 0) {
      return byContentEditable;
    }

    const generic = page.locator("textarea, input[type='text'], input:not([type])").first();
    if ((await generic.count()) > 0) {
      return generic;
    }

    throw new Error("could not locate chat input");
  }

  private async fillFirstAvailable(page: Page, selectors: string[], value: string): Promise<void> {
    const input = await this.resolveFirstVisible(page, selectors);
    await input.fill(value);
  }

  private async resolveFirstVisible(page: Page, selectors: string[]): Promise<Locator> {
    return resolveFirstVisible(page, selectors);
  }

  private async resolveDesireInput(): Promise<Locator> {
    const page = this.pageOrThrow();

    const byPlaceholder = page.getByPlaceholder("Add an item").first();
    if ((await byPlaceholder.count()) > 0) {
      return byPlaceholder;
    }

    const generic = page.locator("input[type='text'], input:not([type]), textarea").first();
    if ((await generic.count()) > 0) {
      return generic;
    }

    throw new Error("could not locate desire input");
  }

  private async resolveGoalTitleInput(scope?: SearchRoot): Promise<Locator> {
    const page = this.pageOrThrow();
    const root: SearchRoot = scope ?? page;

    const byPlaceholder = root.locator('textarea[placeholder*="E.g." i], textarea[placeholder*="goal" i]').first();
    if ((await byPlaceholder.count()) > 0) {
      return byPlaceholder;
    }

    const textareas = root.locator("textarea");
    const textareasCount = await textareas.count();
    for (let i = 0; i < textareasCount; i += 1) {
      const field = textareas.nth(i);
      const placeholder = ((await field.getAttribute("placeholder")) ?? "").toLowerCase();
      if (placeholder.includes("type your message")) {
        continue;
      }
      return field;
    }

    const titleField = root.locator('input[type="text"], input:not([type])').first();
    if ((await titleField.count()) > 0) {
      return titleField;
    }

    const anyField = root.locator("textarea, input").first();
    if ((await anyField.count()) > 0) {
      return anyField;
    }

    throw new Error("could not locate create-goal title input");
  }

  private async resolveCreateGoalPanel(): Promise<Locator | null> {
    const page = this.pageOrThrow();
    const heading = page.getByText(/Create a New Goal/i).first();
    if ((await heading.count()) === 0) {
      return null;
    }
    const panel = heading.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
    if ((await panel.count()) === 0) {
      return null;
    }
    return panel;
  }

  private async selectCreateGoalCategory(category: string): Promise<boolean> {
    const page = this.pageOrThrow();
    const prompt = page.getByText(/Choose a category for your goal/i).first();
    const variants = [titleCase(category), category.toUpperCase(), category.toLowerCase()];

    if ((await prompt.count()) > 0) {
      const container = prompt.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
      const clicked = await this.tryClickByText(container, variants);
      if (clicked) {
        return true;
      }
    }

    return this.tryClickByText(page, variants);
  }

  private async readGoalCount(label: "Active" | "Complete" | "Archived" | "All"): Promise<number | null> {
    const page = this.pageOrThrow();
    const node = page.getByText(new RegExp(`^${label}\\s*\\((\\d+)\\)$`, "i")).first();
    if ((await node.count()) === 0) {
      return null;
    }
    const text = ((await node.textContent()) || "").trim();
    const match = text.match(/\((\d+)\)/);
    if (!match) {
      return null;
    }
    return Number(match[1]);
  }

  private async resolveTaskInput(): Promise<Locator> {
    const taskPanel = await this.resolveTaskPanel();
    if (!taskPanel) {
      throw new Error("could not locate goal task panel");
    }

    const byPlaceholder = taskPanel
      .locator(
        'input[placeholder*=\"Add\" i], textarea[placeholder*=\"Add\" i], input[placeholder*=\"task\" i], textarea[placeholder*=\"task\" i]'
      )
      .first();
    if ((await byPlaceholder.count()) > 0 && (await byPlaceholder.isVisible().catch(() => false))) {
      return byPlaceholder;
    }

    const byTextboxRole = taskPanel.getByRole("textbox").first();
    if ((await byTextboxRole.count()) > 0 && (await byTextboxRole.isVisible().catch(() => false))) {
      const placeholder = ((await byTextboxRole.getAttribute("placeholder")) ?? "").toLowerCase();
      if (!placeholder.toLowerCase().includes("type your message")) {
        return byTextboxRole;
      }
    }

    const byContentEditable = taskPanel.locator('[contenteditable=\"true\"]').first();
    if ((await byContentEditable.count()) > 0 && (await byContentEditable.isVisible().catch(() => false))) {
      return byContentEditable;
    }

    const candidates = taskPanel.locator("textarea, input[type='text'], input:not([type])");
    const count = await candidates.count();
    for (let i = 0; i < count; i += 1) {
      const field = candidates.nth(i);
      const placeholder = (await field.getAttribute("placeholder")) ?? "";
      if (placeholder.toLowerCase().includes("type your message")) {
        continue;
      }
      return field;
    }

    throw new Error("could not locate task input");
  }

  private async ensureTaskPanelVisible(): Promise<void> {
    const panel = await this.resolveTaskPanel();
    if (panel && (await panel.count()) > 0) {
      return;
    }
    const page = this.pageOrThrow();
    const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    throw new StateError(`could not locate goal task panel (url=${page.url()} snippet=${snippet})`, {
      action: "inspect task panel anchors",
      detail: "task UI may have moved or stayed collapsed"
    });
  }

  private async isTaskPanelVisible(): Promise<boolean> {
    const panel = await this.resolveTaskPanel();
    return Boolean(panel && (await panel.count()) > 0);
  }

  private async waitForGoalContext(goalTitle?: string, timeoutMs = 8000): Promise<boolean> {
    const page = this.pageOrThrow();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.isGoalContextOpen(goalTitle)) {
        return true;
      }
      await page.waitForTimeout(250);
    }

    return false;
  }

  private async resolveTaskPanel(): Promise<Locator | null> {
    const page = this.pageOrThrow();
    const candidates = [
      page.getByText(/How will you accomplish/i).first(),
      page.getByText(/Select Tasks/i).first(),
      page.getByText(/Add new task/i).first(),
      page.getByText(/Use the task suggestion tool/i).first()
    ];

    for (const anchor of candidates) {
      if ((await anchor.count()) === 0) {
        continue;
      }
      const panel = anchor.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
      if ((await panel.count()) > 0) {
        return panel;
      }
    }

    return null;
  }

  private async resolveTaskRow(taskText: string): Promise<Locator> {
    const row = await this.resolveRowByText(taskText);
    if (!row) {
      throw new Error(`could not locate task row: ${taskText}`);
    }
    return row;
  }

  private async resolveRowByText(text: string, required = true): Promise<Locator | null> {
    const page = this.pageOrThrow();
    const node = page.getByText(text, { exact: false }).first();
    if ((await node.count()) === 0) {
      if (!required) {
        return null;
      }
      throw new Error(`could not locate text: ${text}`);
    }
    return node.locator("xpath=ancestor::*[self::div or self::li or self::article or self::section][1]");
  }

  private async clickGoalCardAction(goalTitle: string, actionTexts: string[]): Promise<void> {
    const ok = await this.tryClickGoalCardAction(goalTitle, actionTexts);
    if (!ok) {
      throw new Error(`could not execute goal action ${actionTexts.join("/")} for goal: ${goalTitle}`);
    }
  }

  private async tryClickStartInGoalsList(): Promise<boolean> {
    const page = this.pageOrThrow();
    const yourGoals = page.getByText(/YOUR GOALS/i).first();
    if ((await yourGoals.count()) === 0) {
      return false;
    }

    const scope = yourGoals.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
    const startButton = scope.getByRole("button", { name: /^start$/i }).first();
    if ((await startButton.count()) > 0 && (await startButton.isVisible().catch(() => false))) {
      await startButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await startButton.click({ timeout: 1500 }).catch(() => undefined);
      return true;
    }

    return this.tryClickByText(page, ["START"], scope);
  }

  private async tryOpenAnyGoalByLink(): Promise<boolean> {
    const page = this.pageOrThrow();
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
    if (!href) {
      return false;
    }
    const absolute = new URL(href, page.url()).toString();
    await page.goto(absolute, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    return true;
  }

  private async openGoalContextById(goalId: string): Promise<void> {
    const page = this.pageOrThrow();
    const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
    await page.goto(`${base}/self-maximize?goalId=${encodeURIComponent(goalId)}`, { waitUntil: "domcontentloaded" });
  }

  private async listGoalIdsFromPage(): Promise<string[]> {
    const page = this.pageOrThrow();
    const ids = await page.evaluate(() => {
      const found = new Set<string>();

      const fromHref = (href: string | null): void => {
        if (!href) return;
        const match = href.match(/goalId=([A-Za-z0-9_-]+)/i);
        if (match?.[1]) found.add(match[1]);
      };

      for (const el of Array.from(document.querySelectorAll("a[href]"))) {
        fromHref(el.getAttribute("href"));
      }
      for (const el of Array.from(document.querySelectorAll("[data-goal-id], [data-goalid], [goalid]"))) {
        const value =
          el.getAttribute("data-goal-id") ?? el.getAttribute("data-goalid") ?? el.getAttribute("goalid") ?? "";
        if (/^[A-Za-z0-9_-]{8,}$/.test(value)) {
          found.add(value);
        }
      }

      const html = document.documentElement.innerHTML;
      for (const match of html.matchAll(/goalId=([A-Za-z0-9_-]+)/gi)) {
        if (match[1]) found.add(match[1]);
      }

      return [...found];
    });
    return ids;
  }

  private goalIdFromUrl(url: string): string | undefined {
    return goalIdFromUrl(url);
  }

  private async tryClickGoalCardAction(goalTitle: string, actionTexts: string[]): Promise<boolean> {
    const page = this.pageOrThrow();
    const title = page.getByText(goalTitle, { exact: false }).first();
    if ((await title.count()) === 0) {
      return false;
    }

    const card = title.locator(
      "xpath=ancestor::*[self::article or self::section or self::div][.//button or .//*[@role='button']][1]"
    );

    return this.tryClickByText(page, actionTexts, card);
  }

  private async clickByText(root: SearchRoot, texts: string[], scope?: Locator): Promise<void> {
    await clickByText(root, texts, scope);
  }

  private async tryClickByCss(root: SearchRoot, selectors: string[], scope?: Locator): Promise<boolean> {
    return tryClickByCss(root, selectors, scope);
  }

  private async ensureGoalsWorkspaceVisible(): Promise<void> {
    const page = this.pageOrThrow();
    const ok = await this.waitForGoalsWorkspaceVisible();
    if (!ok) {
      const snippet = (await page.locator("body").innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .slice(0, 500);
      throw new AuthError(`login did not reach goals workspace (url=${page.url()} snippet=${snippet})`, {
        action: "reuse a validated long-lived session",
        detail: "goals workspace readiness never reached the archived-count threshold"
      });
    }
  }

  private async waitForGoalsWorkspaceVisible(timeoutMs = 15000): Promise<boolean> {
    const page = this.pageOrThrow();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isGoalsWorkspaceVisible()) {
        return true;
      }
      await page.waitForTimeout(500);
    }
    return false;
  }

  private async isGoalsWorkspaceVisible(): Promise<boolean> {
    const page = this.pageOrThrow();
    const onGoalsUrl = /\/goals(\?|$)/.test(page.url());
    const anchor = page.getByText(new RegExp(this.escapeRegex(textSelectors(selectors.goals.workspaceAnchors)[0]), "i")).first();
    const categories = page.getByText(new RegExp(this.escapeRegex(textSelectors(selectors.goals.workspaceAnchors)[1]), "i")).first();
    const hasAnchorText = (await anchor.count()) > 0 || (await categories.count()) > 0;
    if (!(onGoalsUrl && hasAnchorText)) {
      return false;
    }

    const archivedCount = await this.readGoalCount("Archived");
    if (config.SELFMAX_AUTH_MIN_ARCHIVED > 0) {
      return archivedCount !== null && archivedCount >= config.SELFMAX_AUTH_MIN_ARCHIVED;
    }

    return true;
  }

  private async persistAuthState(): Promise<void> {
    if (!this.context) {
      return;
    }
    const dir = dirname(config.SELFMAX_STORAGE_STATE_PATH);
    mkdirSync(dir, { recursive: true });
    await this.context.storageState({ path: config.SELFMAX_STORAGE_STATE_PATH });
  }

  private async tryClickByText(root: SearchRoot, texts: string[], scope?: Locator): Promise<boolean> {
    return tryClickByText(root, texts, scope);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private titleCase(value: string): string {
    return titleCase(value);
  }

  private normalizeDateInput(input: string): string | null {
    return normalizeDateInput(input);
  }

  private cacheGoal(entry: {
    goalId: string;
    title?: string;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
    taskPanelState?: "tasks_present" | "add_tasks" | "empty";
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
  }): void {
    const existing = this.entityCache.goalsById[entry.goalId];
    this.entityCache.goalsById[entry.goalId] = {
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

  private cacheDesire(entry: {
    desireId: string;
    title?: string;
    category?: string;
  }): void {
    const existing = this.entityCache.desiresById[entry.desireId];
    this.entityCache.desiresById[entry.desireId] = {
      desireId: entry.desireId,
      title: entry.title ?? existing?.title,
      category: entry.category ?? existing?.category,
      lastSeenAt: new Date().toISOString()
    };
  }

  private findDesireIdByTitle(title: string): string | undefined {
    const normalized = title.trim().toLowerCase();
    for (const entry of Object.values(this.entityCache.desiresById)) {
      if (entry.title?.trim().toLowerCase() === normalized) {
        return entry.desireId;
      }
    }
    return undefined;
  }

  private findGoalIdByTitle(title: string): string | undefined {
    const normalized = title.trim().toLowerCase();
    for (const entry of Object.values(this.entityCache.goalsById)) {
      if (entry.title?.trim().toLowerCase() === normalized) {
        return entry.goalId;
      }
    }
    return undefined;
  }

  private storageKeyFor(session: SessionContext): string {
    return `${config.SELFMAX_STATE_KEY}:${session.userId}:${session.sessionId}`;
  }
}
