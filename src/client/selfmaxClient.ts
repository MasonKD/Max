import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { existsSync } from "node:fs";
import { config } from "../core/config.js";
import { AtomicExecutor } from "../core/atomic.js";
import type { PrimitiveName, PrimitiveRequest, PrimitiveResponseOf, SessionContext } from "../core/types.js";
import { createReadPrimitiveHandlers, createWritePrimitiveHandlers } from "../api/index.js";
import type { PrimitiveReadResult } from "../api/primitives-read.js";
import type { PrimitiveWriteResult } from "../api/primitives-write.js";
import { clickByText, resolveFirstVisible, tryClickByCss, tryClickByText } from "../platform/navigation.js";
import { formatError } from "../core/recovery.js";
import { SessionGate } from "./sessionGate.js";
import { createAuthSupport, createAuthWorkflow } from "../features/auth/index.js";
import { createGoalsSupport, createGoalsWorkflow } from "../features/goals/index.js";
import { createLifestormingSupport, createLifestormingWorkflow } from "../features/lifestorming/index.js";
import { createSessionEntityCache, cacheGoal, cacheDesire, findGoalIdByTitle, findDesireByTitle, findDesireIdByTitle, type SessionEntityCache } from "./entityCache.js";

export class SelfMaxPlaywrightClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private workPage?: Page;
  private goalsPage?: Page;
  private lifestormingPage?: Page;
  private goalWorkspacePage?: Page;
  private readonly atomic = new AtomicExecutor();
  private readonly entityCache: SessionEntityCache = createSessionEntityCache();
  private readonly sessionGate = new SessionGate();
  private readonly authSupport = createAuthSupport({
    pageOrThrow: () => this.pageOrThrow(),
    context: () => this.context
  });
  private readonly lifestormingSupport = createLifestormingSupport({
    pageOrThrow: () => this.pageOrThrow()
  });
  private readonly authWorkflow = createAuthWorkflow({
    ensurePage: () => this.ensurePage(),
    pageOrThrow: () => this.pageOrThrow(),
    persistAuthState: () => this.authSupport.persistAuthState(),
    isGoalsWorkspaceVisible: () => this.authSupport.isGoalsWorkspaceVisible(),
    ensureGoalsWorkspaceVisible: () => this.authSupport.ensureGoalsWorkspaceVisible(),
    resolveFirstVisible: (page, selectors) => resolveFirstVisible(page, selectors),
    tryClickByCss,
    tryClickByText,
    resolveChatInput: () => this.authSupport.resolveChatInput(),
    storageKeyFor: (session) => this.authSupport.storageKeyFor(session),
    readGoalCount: (label) => this.authSupport.readGoalCount(label),
    sessionGate: this.sessionGate
  });
  private readonly goalsSupport = createGoalsSupport({
    pageOrThrow: () => this.pageOrThrow(),
    ensureOnGoals: () => this.authWorkflow.ensureOnGoals(),
    tryClickByText,
    openGoalContextById: (goalId: string) => this.goalsSupport.openGoalContextById(goalId),
    startGoal: (goalTitle?: string, goalId?: string) => this.goalsWorkflow.startGoal(goalTitle, goalId),
    cacheGoal: (entry) => cacheGoal(this.entityCache, entry),
    findGoalIdByTitle: (title: string) => findGoalIdByTitle(this.entityCache, title),
    listGoals: (filter: string) => this.goalsWorkflow.listGoals(filter)
  });
  private readonly goalsWorkflow = createGoalsWorkflow({
    ensurePage: () => this.ensurePage(),
    pageOrThrow: () => this.pageOrThrow(),
    context: () => this.context,
    ensureOnGoals: () => this.authWorkflow.ensureOnGoals(),
    tryClickByText,
    clickByText,
    resolveGoalTitleInput: (scope) => this.goalsSupport.resolveGoalTitleInput(scope),
    resolveCreateGoalPanel: () => this.goalsSupport.resolveCreateGoalPanel(),
    selectCreateGoalCategory: (category: string) => this.goalsSupport.selectCreateGoalCategory(category),
    readGoalCount: (label: "Active" | "Complete" | "Archived" | "All") => this.authSupport.readGoalCount(label),
    readAuthState: () => this.authWorkflow.readAuthState(),
    openGoalForRead: (goalTitle?: string, goalId?: string) => this.goalsSupport.openGoalForRead(goalTitle, goalId),
    openGoalContext: (goalTitle) => this.goalsSupport.openGoalContext(goalTitle),
    openGoalContextById: (goalId: string) => this.goalsSupport.openGoalContextById(goalId),
    waitForGoalContext: (goalTitle?: string, timeoutMs?: number) => this.goalsSupport.waitForGoalContext(goalTitle, timeoutMs),
    waitForGoalDataLoaded: (timeoutMs?: number, page?: Page) => this.goalsSupport.waitForGoalDataLoaded(timeoutMs, page),
    isGoalWorkspaceVisible: () => this.goalsSupport.isGoalWorkspaceVisible(),
    captureCurrentGoalWorkspace: () => this.goalsSupport.captureCurrentGoalWorkspace(),
    readBodySnippet: () => this.goalsSupport.readBodySnippet(),
    cacheGoal: (entry: { goalId: string; title?: string; category?: string; dueLabel?: string; progressLabel?: string; taskPanelState?: "tasks_present" | "add_tasks" | "empty"; taskSummaryLabel?: string; taskPreviewItems?: string[] }) => cacheGoal(this.entityCache, entry),
    findGoalIdByTitle: (title: string) => findGoalIdByTitle(this.entityCache, title),
    listGoalIdsFromPage: () => this.goalsSupport.listGoalIdsFromPage(),
    tryOpenAnyGoalByLink: () => this.goalsSupport.tryOpenAnyGoalByLink(),
    tryClickStartInGoalsList: () => this.goalsSupport.tryClickStartInGoalsList(),
    tryClickGoalCardAction: (goalTitle: string, actionTexts: string[]) => this.goalsSupport.tryClickGoalCardAction(goalTitle, actionTexts),
    resolveTaskInput: () => this.goalsSupport.resolveTaskInput(),
    submitTaskInput: (field: Locator) => this.goalsSupport.submitTaskInput(field),
    resolveTaskRow: (taskText: string) => this.goalsSupport.resolveTaskRow(taskText),
    resolveTaskRowWithinPanel: (taskText: string) => this.goalsSupport.resolveTaskRowWithinPanel(taskText),
    readVisibleTaskItems: () => this.goalsSupport.readVisibleTaskItems(),
    waitForTaskToAppear: (taskText: string, timeoutMs?: number) => this.goalsSupport.waitForTaskToAppear(taskText, timeoutMs),
    waitForTaskState: (taskText: string, completed: boolean, timeoutMs?: number) => this.goalsSupport.waitForTaskState(taskText, completed, timeoutMs),
    waitForTaskToDisappear: (taskText: string, timeoutMs?: number) => this.goalsSupport.waitForTaskToDisappear(taskText, timeoutMs),
    ensureOnGoalTaskContext: (goalTitle?: string, goalId?: string) => this.goalsSupport.ensureOnGoalTaskContext(goalTitle, goalId),
    isTaskPanelVisible: () => this.goalsSupport.isTaskPanelVisible(),
    resolveTaskPanel: () => this.goalsSupport.resolveTaskPanel(),
    openTaskPanel: () => this.goalsSupport.openTaskPanel(),
    withTemporaryPage: <T>(fn: (page: Page) => Promise<T>) => this.lifestormingWorkflow.withTemporaryPage(fn),
    getGoalTaskSummary: (goalTitle?: string, goalId?: string) => this.goalsSupport.getGoalTaskSummary(goalTitle, goalId),
    resolveGoalCard: (goalTitle: string) => this.goalsSupport.resolveGoalCard(goalTitle),
    resolveTaskRowInGoalCard: (goalTitle: string, taskText: string) => this.goalsSupport.resolveTaskRowInGoalCard(goalTitle, taskText),
    readGoalCardTaskCompletion: (goalTitle: string) => this.goalsSupport.readGoalCardTaskCompletion(goalTitle),
    waitForGoalCardTaskCompletionDelta: (goalTitle: string, previousCompleted: number, delta: number, timeoutMs?: number) => this.goalsSupport.waitForGoalCardTaskCompletionDelta(goalTitle, previousCompleted, delta, timeoutMs),
    clickGoalCardTaskToggle: (goalTitle: string, taskText: string) => this.goalsSupport.clickGoalCardTaskToggle(goalTitle, taskText),
    clickGoalCardTaskRemove: (goalTitle: string, taskText: string) => this.goalsSupport.clickGoalCardTaskRemove(goalTitle, taskText),
    entityGoals: () => this.entityCache.goalsById,
    isGoalContextOpen: (goalTitle?: string) => this.goalsSupport.isGoalContextOpen(goalTitle),
    resolveDesireCategory: async (desireTitle: string) => {
      const cached = findDesireByTitle(this.entityCache, desireTitle);
      if (cached?.category?.trim()) return cached.category;
      const result = await this.lifestormingWorkflow.readSensationPractice(undefined, desireTitle).catch(() => null);
      return result?.category?.trim() ? result.category : undefined;
    },
    updateGoalDueDateFromGoals: (goalTitle: string, dueDateInput: string) => this.goalsSupport.updateGoalDueDateFromGoals(goalTitle, dueDateInput),
    formatGoalDueLabel: (input: string) => this.goalsSupport.formatGoalDueLabel(input),
    waitForGoalDueLabel: (goalTitle: string, expectedLabel: string, timeoutMs?: number) => this.goalsSupport.waitForGoalDueLabel(goalTitle, expectedLabel, timeoutMs),
    openGoalEditPanel: () => this.goalsSupport.openGoalEditPanel(),
    openGoalStatusMenu: () => this.goalsSupport.openGoalStatusMenu(),
    clickGoalStatusAction: (status: "active" | "completed" | "archived") => this.goalsSupport.clickGoalStatusAction(status)
  });
  private readonly lifestormingWorkflow = createLifestormingWorkflow({
    ensurePage: () => this.ensurePage(),
    pageOrThrow: () => this.pageOrThrow(),
    context: () => this.context,
    clickByText,
    tryClickByText,
    resolveDesireInput: () => this.lifestormingSupport.resolveDesireInput(),
    resolveRowByText: (text: string, required?: boolean) => this.lifestormingSupport.resolveRowByText(text, required),
    waitForPageTextNotContaining: (needle: string, timeoutMs?: number, page?: Page) => this.lifestormingSupport.waitForPageTextNotContaining(needle, timeoutMs, page),
    waitForDesiresCategory: (category: string, timeoutMs?: number, page?: Page) => this.lifestormingSupport.waitForDesiresCategory(category, timeoutMs, page),
    cacheDesire: (entry: { desireId: string; title?: string; category?: string }) => cacheDesire(this.entityCache, entry),
    findDesireIdByTitle: (title: string) => findDesireIdByTitle(this.entityCache, title),
    entityDesires: () => this.entityCache.desiresById
  });
  private readonly handlers: Partial<Record<PrimitiveName, (req: PrimitiveRequest, session: SessionContext) => Promise<PrimitiveReadResult | PrimitiveWriteResult>>> = {
    ...createReadPrimitiveHandlers({
      login: () => this.authWorkflow.login(),
      getState: (session) => this.authWorkflow.getState(session),
      readAuthState: () => this.authWorkflow.readAuthState(),
      readCurrentRoute: () => this.authWorkflow.readCurrentRoute(),
      readKnownRoutes: () => this.authWorkflow.readKnownRoutes(),
      readGoalsOverview: () => this.goalsWorkflow.readGoalsOverview(),
      readRouteSnapshot: (route, url) => this.authWorkflow.readRouteSnapshot(route, url),
      readPageSections: (route, url) => this.authWorkflow.readPageSections(route, url, (resolvedRoute, resolvedUrl) => this.authWorkflow.navigateForRead(resolvedRoute, resolvedUrl)),
      discoverLinks: (route, url) => this.authWorkflow.discoverLinks(route, url, (resolvedRoute, resolvedUrl) => this.authWorkflow.navigateForRead(resolvedRoute, resolvedUrl)),
      listGoals: (filter) => this.goalsWorkflow.listGoals(filter),
      discoverGoals: (waitMs) => this.goalsWorkflow.discoverGoals(waitMs),
      readGoalFull: (goalTitle, goalId) => this.goalsWorkflow.readGoalFull(goalTitle, goalId),
      readGoalStatusDetails: (goalTitle, goalId) => this.goalsWorkflow.readGoalStatusDetails(goalTitle, goalId),
      readCachedDesires: () => this.lifestormingWorkflow.readCachedDesires(),
      listGoalTasks: (goalTitle, goalId) => this.goalsWorkflow.listGoalTasks(goalTitle, goalId),
      readTaskSuggestions: (goalTitle) => this.goalsWorkflow.readTaskSuggestions(goalTitle, undefined),
      readGoalChat: (goalTitle, goalId) => this.goalsWorkflow.readGoalChat(goalTitle, goalId),
      readUnderstandOverview: () => this.authWorkflow.readUnderstandOverview(),
      readLevelCheck: () => this.authWorkflow.readLevelCheck(),
      readLifeHistoryAssessment: () => this.authWorkflow.readLifeHistoryAssessment(),
      readBigFiveAssessment: () => this.authWorkflow.readBigFiveAssessment(),
      readLifestormingOverview: () => this.lifestormingWorkflow.readLifestormingOverview(),
      readSensationPractice: (desireId, desireTitle) => this.lifestormingWorkflow.readSensationPractice(desireId, desireTitle),
      readCoachMessages: () => this.authWorkflow.readCoachMessages()
    }),
    ...createWritePrimitiveHandlers({
      talkToGuide: (message) => this.authWorkflow.talkToGuide(message),
      talkToGoalChat: (message, goalTitle) => this.authWorkflow.talkToGoalChat(message, goalTitle, (resolvedGoalTitle) => this.goalsSupport.openGoalContext(resolvedGoalTitle)),
      brainstormDesiresForEachCategory: (items) => this.lifestormingWorkflow.brainstormDesiresForEachCategory(items),
      feelOutDesires: (desires) => this.lifestormingWorkflow.feelOutDesires(desires),
      createGoalsFromDesires: (desires) => this.goalsWorkflow.createGoalsFromDesires(desires),
      createGoal: (input) => this.goalsWorkflow.createGoal(input),
      updateGoal: (goalTitle, updates) => this.goalsWorkflow.updateGoal(goalTitle, updates),
      startGoal: (goalTitle, goalId) => this.goalsWorkflow.startGoal(goalTitle, goalId),
      addTasks: (goalTitle, goalId, tasks, useSuggestions) => this.goalsWorkflow.addTasks(goalTitle, goalId, tasks, useSuggestions),
      removeTask: (goalTitle, goalId, taskText) => this.goalsWorkflow.removeTask(goalTitle, goalId, taskText),
      completeTask: (goalTitle, goalId, taskText) => this.goalsWorkflow.completeTask(goalTitle, goalId, taskText),
      uncompleteTask: (goalTitle, goalId, taskText) => this.goalsWorkflow.uncompleteTask(goalTitle, goalId, taskText)
    })
  };

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.HEADLESS });
    const contextOptions = existsSync(config.SELFMAX_STORAGE_STATE_PATH)
      ? { storageState: config.SELFMAX_STORAGE_STATE_PATH }
      : undefined;
    this.context = await this.browser.newContext(contextOptions);
    this.workPage = await this.context.newPage();
    this.goalsPage = await this.context.newPage();
    this.page = this.workPage;
  }

  async close(): Promise<void> {
    this.sessionGate.clear();
    const pages = [this.workPage, this.goalsPage, this.lifestormingPage, this.goalWorkspacePage].filter(
      (page, index, list): page is Page => Boolean(page) && list.indexOf(page) === index
    );
    for (const page of pages) {
      await page.close().catch(() => undefined);
    }
    await this.context?.close();
    await this.browser?.close();
  }

  async execute(req: PrimitiveRequest, session: SessionContext): Promise<PrimitiveResponseOf<PrimitiveReadResult | PrimitiveWriteResult>> {
    try {
      const result = await this.atomic.run(async () => {
        const previousPage = this.page;
        this.page = await this.resolveOwnedPage(req.name);
        const handler = this.handlers[req.name];
        if (!handler) {
          throw new Error(`unsupported primitive: ${String(req.name)}`);
        }
        try {
          return await handler(req, session);
        } finally {
          this.page = previousPage;
        }
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

  async executeInTemporaryPage(req: PrimitiveRequest, session: SessionContext): Promise<PrimitiveResponseOf<PrimitiveReadResult | PrimitiveWriteResult>> {
    try {
      const result = await this.atomic.run(async () => {
        const previousPage = this.page;
        this.page = await this.resolveOwnedPage(req.name, true);
        const handler = this.handlers[req.name];
        if (!handler) {
          throw new Error(`unsupported primitive: ${String(req.name)}`);
        }
        try {
          return await handler(req, session);
        } finally {
          this.page = previousPage;
        }
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

  private ensurePage(): Page {
    if (!this.page) {
      throw new Error("playwright client not initialized");
    }
    return this.page;
  }

  private pageOrThrow(): Page {
    return this.ensurePage();
  }

  private async ensureGoalsPage(): Promise<Page> {
    if (!this.context) throw new Error("playwright client not initialized");
    if (!this.goalsPage || this.goalsPage.isClosed()) {
      this.goalsPage = await this.context.newPage();
    }
    return this.goalsPage;
  }

  private async ensureWorkPage(): Promise<Page> {
    if (!this.context) throw new Error("playwright client not initialized");
    if (!this.workPage || this.workPage.isClosed()) {
      this.workPage = await this.context.newPage();
    }
    return this.workPage;
  }

  private async ensureLifestormingPage(): Promise<Page> {
    if (!this.context) throw new Error("playwright client not initialized");
    if (!this.lifestormingPage || this.lifestormingPage.isClosed()) {
      this.lifestormingPage = await this.context.newPage();
    }
    return this.lifestormingPage;
  }

  private async ensureGoalWorkspacePage(): Promise<Page> {
    if (!this.context) throw new Error("playwright client not initialized");
    if (!this.goalWorkspacePage || this.goalWorkspacePage.isClosed()) {
      this.goalWorkspacePage = await this.context.newPage();
    }
    return this.goalWorkspacePage;
  }

  private async resolveOwnedPage(name: PrimitiveName, preferPeek = false): Promise<Page> {
    if ([
      "login",
      "get_state",
      "create_goal",
      "update_goal",
      "read_route_snapshot",
      "read_page_sections",
      "discover_links",
      "read_understand_overview",
      "read_level_check",
      "read_life_history_assessment",
      "read_big_five_assessment"
    ].includes(name)) {
      return this.ensureWorkPage();
    }

    if ([
      "brainstorm_desires_for_each_category",
      "feel_out_desires",
      "read_lifestorming_overview",
      "read_cached_desires",
      "read_sensation_practice"
    ].includes(name)) {
      return this.ensureLifestormingPage();
    }

    if ([
      "talk_to_goal_chat",
      "read_goal_full",
      "read_goal_status_details",
      "list_goal_tasks",
      "read_task_suggestions",
      "read_goal_chat",
      "start_goal",
      "add_tasks",
      "remove_task",
      "complete_task",
      "uncomplete_task"
    ].includes(name)) {
      return this.ensureGoalWorkspacePage();
    }

    return this.ensureGoalsPage();
  }

}
