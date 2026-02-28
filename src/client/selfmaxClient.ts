import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync } from "node:fs";
import { config } from "../core/config.js";
import { AtomicExecutor } from "../core/atomic.js";
import type { PrimitiveName, PrimitiveRequest, PrimitiveResponse, SessionContext } from "../core/types.js";
import type { KnownRouteId } from "../platform/catalog.js";
import { createReadPrimitiveHandlers, createWritePrimitiveHandlers } from "../api/index.js";
import { clickByText, resolveFirstVisible, tryClickByCss, tryClickByText } from "../platform/navigation.js";
import { formatError } from "../core/recovery.js";
import { SessionGate } from "./sessionGate.js";
import { createAuthSupport, createAuthWorkflow } from "../features/auth/index.js";
import { createGoalsSupport, createGoalsWorkflow } from "../features/goals/index.js";
import { createLifestormingSupport, createLifestormingWorkflow } from "../features/lifestorming/index.js";
import { createSessionEntityCache, cacheGoal, cacheDesire, findGoalIdByTitle, findDesireIdByTitle, type SessionEntityCache } from "./entityCache.js";

export class SelfMaxPlaywrightClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
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
    discoverGoalIds: (waitMs?: unknown) => this.goalsSupport.discoverGoalIds(waitMs),
    tryOpenAnyGoalByLink: () => this.goalsSupport.tryOpenAnyGoalByLink(),
    tryClickStartInGoalsList: () => this.goalsSupport.tryClickStartInGoalsList(),
    tryClickGoalCardAction: (goalTitle: string, actionTexts: string[]) => this.goalsSupport.tryClickGoalCardAction(goalTitle, actionTexts),
    resolveTaskInput: () => this.goalsSupport.resolveTaskInput(),
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
    deleteTaskViaFirestore: (goalId: string, taskText: string) => this.goalsSupport.deleteTaskViaFirestore(goalId, taskText),
    waitForTaskDocumentWrite: (goalId: string, taskText: string, timeoutMs?: number) => this.goalsSupport.waitForTaskDocumentWrite(goalId, taskText, timeoutMs),
    updateGoalStatusViaFirestore: (goalId: string, status: "active" | "completed" | "archived") => this.goalsSupport.updateGoalStatusViaFirestore(goalId, status),
    updateGoalDueDateViaFirestore: (goalId: string, dueDateIso: string) => this.goalsSupport.updateGoalDueDateViaFirestore(goalId, dueDateIso),
    readGoalSourceDocs: (goalId: string) => this.goalsSupport.readGoalFirestoreDocuments(goalId),
    entityGoals: () => this.entityCache.goalsById,
    isGoalContextOpen: (goalTitle?: string) => this.goalsSupport.isGoalContextOpen(goalTitle),
    tryPromoteDesireToGoal: (desireTitle: string) => this.lifestormingWorkflow.tryPromoteDesireToGoal(desireTitle),
    updateGoalDueDateFromGoals: (goalTitle: string, dueDateInput: string) => this.goalsSupport.updateGoalDueDateFromGoals(goalTitle, dueDateInput),
    formatGoalDueLabel: (input: string) => this.goalsSupport.formatGoalDueLabel(input),
    waitForGoalDueLabel: (goalTitle: string, expectedLabel: string, timeoutMs?: number) => this.goalsSupport.waitForGoalDueLabel(goalTitle, expectedLabel, timeoutMs)
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
    readDesireSourceDoc: async (desireId: string) => {
      const result = await this.goalsSupport.readFirestoreDocument(`users/${(await this.goalsSupport.getFirestoreAuthContext()).userId}/lifestormDesires/${desireId}`) as { ok?: boolean; body?: unknown };
      return { desireDoc: result?.ok ? result.body : undefined };
    },
    updateDesireNotesViaFirestore: (desireId: string, notes: string) => this.goalsSupport.updateDesireNotesViaFirestore(desireId, notes),
    entityDesires: () => this.entityCache.desiresById
  });
  private readonly handlers = {
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
      discoverGoalIds: (waitMs) => this.goalsSupport.discoverGoalIds(waitMs),
      readGoal: (goalTitle, goalId) => this.goalsWorkflow.readGoal(goalTitle, goalId),
      readGoalMetadata: (goalTitle, goalId) => this.goalsWorkflow.readGoalMetadata(goalTitle, goalId),
      readGoalWorkspace: (goalTitle, goalId) => this.goalsWorkflow.readGoalWorkspace(goalTitle, goalId),
      readGoalFull: (goalTitle, goalId) => this.goalsWorkflow.readGoalFull(goalTitle, goalId),
      readGoalSourceDocs: (goalId) => {
        if (!goalId) throw new Error("read_goal_source_docs requires payload.goalId");
        return this.goalsSupport.readGoalFirestoreDocuments(goalId);
      },
      readGoalStatusDetails: (goalTitle, goalId) => this.goalsWorkflow.readGoalStatusDetails(goalTitle, goalId),
      readCachedGoals: () => this.goalsWorkflow.readCachedGoals(),
      readCachedDesires: () => this.lifestormingWorkflow.readCachedDesires(),
      readTaskPanelSnapshot: (goalTitle, goalId) => this.goalsWorkflow.readTaskPanelSnapshot(goalTitle, goalId),
      surveyActiveGoalTaskStates: () => this.goalsWorkflow.surveyActiveGoalTaskStates(),
      listGoalTasks: (goalTitle, goalId) => this.goalsWorkflow.listGoalTasks(goalTitle, goalId),
      readTaskSuggestions: (goalTitle) => this.goalsWorkflow.readTaskSuggestions(goalTitle, undefined),
      readGoalChat: (goalTitle, goalId) => this.goalsWorkflow.readGoalChat(goalTitle, goalId),
      readUnderstandOverview: () => this.authWorkflow.readUnderstandOverview(),
      readLevelCheck: () => this.authWorkflow.readLevelCheck(),
      readLifeHistoryAssessment: () => this.authWorkflow.readLifeHistoryAssessment(),
      readBigFiveAssessment: () => this.authWorkflow.readBigFiveAssessment(),
      readLifestormingOverview: () => this.lifestormingWorkflow.readLifestormingOverview(),
      listLifestormingDesires: () => this.lifestormingWorkflow.listLifestormingDesires(),
      readLifestormingCategory: (category) => this.lifestormingWorkflow.readLifestormingCategory(category),
      readLifestormingFull: () => this.lifestormingWorkflow.readLifestormingFull(),
      readSensationPractice: (desireId, desireTitle) => this.lifestormingWorkflow.readSensationPractice(desireId, desireTitle),
      readCoachMessages: () => this.authWorkflow.readCoachMessages(),
      listKnownActions: (route) => this.authWorkflow.listKnownActions(route as KnownRouteId | null)
    }),
    ...createWritePrimitiveHandlers({
      setState: (session, patch) => this.authWorkflow.setState(session, patch),
      talkToGuide: (message) => this.authWorkflow.talkToGuide(message),
      talkToGoalChat: (message, goalTitle) => this.authWorkflow.talkToGoalChat(message, goalTitle, (resolvedGoalTitle) => this.goalsSupport.openGoalContext(resolvedGoalTitle)),
      sendCoachMessage: (message) => this.authWorkflow.sendCoachMessage(message),
      brainstormDesiresForEachCategory: (items) => this.lifestormingWorkflow.brainstormDesiresForEachCategory(items),
      feelOutDesires: (desires) => this.lifestormingWorkflow.feelOutDesires(desires),
      createGoalsFromDesires: (desires) => this.goalsWorkflow.createGoalsFromDesires(desires),
      createGoal: (input) => this.goalsWorkflow.createGoal(input),
      updateGoal: (goalTitle, updates) => this.goalsWorkflow.updateGoal(goalTitle, updates),
      updateGoalDueDate: (goalTitle, goalId, dueDate) => this.goalsWorkflow.updateGoalDueDate(goalTitle, goalId, dueDate),
      startGoal: (goalTitle, goalId) => this.goalsWorkflow.startGoal(goalTitle, goalId),
      addTasks: (goalTitle, goalId, tasks, useSuggestions) => this.goalsWorkflow.addTasks(goalTitle, goalId, tasks, useSuggestions),
      removeTask: (goalTitle, goalId, taskText) => this.goalsWorkflow.removeTask(goalTitle, goalId, taskText),
      completeTask: (goalTitle, goalId, taskText) => this.goalsWorkflow.completeTask(goalTitle, goalId, taskText),
      uncompleteTask: (goalTitle, goalId, taskText) => this.goalsWorkflow.uncompleteTask(goalTitle, goalId, taskText),
      completeGoal: (goalTitle, goalId) => this.goalsWorkflow.completeGoal(goalTitle, goalId),
      reactivateGoal: (goalTitle, goalId) => this.goalsWorkflow.reactivateGoal(goalTitle, goalId),
      archiveGoal: (goalTitle, goalId) => this.goalsWorkflow.archiveGoal(goalTitle, goalId),
      deleteGoal: (goalTitle, goalId) => this.goalsWorkflow.deleteGoal(goalTitle, goalId),
      deleteGoalApi: (goalId) => this.goalsWorkflow.deleteGoalApi(goalId),
      navigate: (route) => this.authWorkflow.navigate(route),
      invokeKnownAction: (payload) => this.authWorkflow.invokeKnownAction(payload)
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
    this.sessionGate.clear();
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

  private ensurePage(): Page {
    if (!this.page) {
      throw new Error("playwright client not initialized");
    }
    return this.page;
  }

  private pageOrThrow(): Page {
    return this.ensurePage();
  }

  async readGoalFirestoreDocuments(goalId: string): Promise<unknown> {
    return this.goalsSupport.readGoalFirestoreDocuments(goalId);
  }

}
