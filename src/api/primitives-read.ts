import type {
  AssessmentQuestionState,
  AuthState,
  DiscoverGoalsResult,
  DiscoverLinksResult,
  GoalStatusDetail,
  GoalSummary,
  GoalsOverviewResult,
  InternalCachedDesiresResult,
  InternalCachedGoalsResult,
  InternalGoalChatResult,
  InternalGoalFullResult,
  InternalGoalListResult,
  InternalGoalMetadataResult,
  InternalGoalReadResult,
  InternalGoalStatusDetailsResult,
  InternalGoalTasksResult,
  InternalGoalWorkspaceResult,
  InternalLifestormingOverviewResult,
  InternalSensationPracticeResult,
  InternalTaskPanelSnapshotResult,
  KnownRoutesResult,
  LifestormingCategoryResult,
  LifestormingDesiresListResult,
  LifestormingFullResult,
  PrimitivePayload,
  PrimitiveName,
  PrimitiveRequest,
  RouteLocationResult,
  RouteSnapshotResult,
  PageSectionsResult,
  SessionContext
  ,
  StateSnapshot,
  SurveyActiveGoalTaskStatesResult,
  TaskSuggestionsResult,
  UnderstandOverviewResult,
  LevelCheckResult,
} from "../core/types.js";
import type { KnownAction } from "../platform/catalog.js";

export type PrimitiveReadResult =
  | StateSnapshot
  | string[]
  | AuthState
  | RouteLocationResult
  | KnownRoutesResult
  | GoalsOverviewResult
  | RouteSnapshotResult
  | PageSectionsResult
  | DiscoverLinksResult
  | DiscoverGoalsResult
  | InternalGoalListResult
  | InternalGoalReadResult
  | InternalGoalMetadataResult
  | InternalGoalWorkspaceResult
  | InternalGoalFullResult
  | InternalGoalStatusDetailsResult
  | InternalCachedGoalsResult
  | InternalGoalTasksResult
  | InternalGoalChatResult
  | InternalCachedDesiresResult
  | InternalLifestormingOverviewResult
  | LifestormingDesiresListResult
  | LifestormingCategoryResult
  | LifestormingFullResult
  | InternalSensationPracticeResult
  | { goals?: GoalSummary[] }
  | { details?: GoalStatusDetail[] }
  | AssessmentQuestionState
  | UnderstandOverviewResult
  | LevelCheckResult
  | InternalTaskPanelSnapshotResult
  | SurveyActiveGoalTaskStatesResult
  | TaskSuggestionsResult
  | readonly KnownAction[];

export type PrimitiveHandler = (req: PrimitiveRequest, session: SessionContext) => Promise<PrimitiveReadResult>;

export type ReadPrimitiveDependencies = {
  login: () => Promise<StateSnapshot>;
  getState: (session: SessionContext) => Promise<StateSnapshot>;
  readAuthState: () => Promise<AuthState>;
  readCurrentRoute: () => Promise<RouteLocationResult>;
  readKnownRoutes: () => Promise<KnownRoutesResult>;
  readGoalsOverview: () => Promise<GoalsOverviewResult>;
  readRouteSnapshot: (route?: string, url?: string) => Promise<RouteSnapshotResult>;
  readPageSections: (route?: string, url?: string) => Promise<PageSectionsResult>;
  discoverLinks: (route?: string, url?: string) => Promise<DiscoverLinksResult>;
  listGoals: (filter: string) => Promise<InternalGoalListResult>;
  discoverGoals: (waitMs?: unknown) => Promise<DiscoverGoalsResult>;
  readGoal: (goalTitle?: string, goalId?: string) => Promise<InternalGoalReadResult>;
  readGoalMetadata: (goalTitle?: string, goalId?: string) => Promise<InternalGoalMetadataResult>;
  readGoalWorkspace: (goalTitle?: string, goalId?: string) => Promise<InternalGoalWorkspaceResult>;
  readGoalFull: (goalTitle?: string, goalId?: string) => Promise<InternalGoalFullResult>;
  readGoalStatusDetails: (goalTitle?: string, goalId?: string) => Promise<InternalGoalStatusDetailsResult>;
  readCachedGoals: () => Promise<InternalCachedGoalsResult>;
  readCachedDesires: () => Promise<InternalCachedDesiresResult>;
  readTaskPanelSnapshot: (goalTitle?: string, goalId?: string) => Promise<InternalTaskPanelSnapshotResult>;
  surveyActiveGoalTaskStates: () => Promise<SurveyActiveGoalTaskStatesResult>;
  listGoalTasks: (goalTitle?: string, goalId?: string) => Promise<InternalGoalTasksResult>;
  readTaskSuggestions: (goalTitle: string) => Promise<TaskSuggestionsResult>;
  readGoalChat: (goalTitle?: string, goalId?: string) => Promise<InternalGoalChatResult>;
  readUnderstandOverview: () => Promise<UnderstandOverviewResult>;
  readLevelCheck: () => Promise<LevelCheckResult>;
  readLifeHistoryAssessment: () => Promise<AssessmentQuestionState>;
  readBigFiveAssessment: () => Promise<AssessmentQuestionState>;
  readLifestormingOverview: () => Promise<InternalLifestormingOverviewResult>;
  listLifestormingDesires: () => Promise<LifestormingDesiresListResult>;
  readLifestormingCategory: (category?: string) => Promise<LifestormingCategoryResult>;
  readLifestormingFull: () => Promise<LifestormingFullResult>;
  readSensationPractice: (desireId?: string, desireTitle?: string) => Promise<InternalSensationPracticeResult>;
  readCoachMessages: () => Promise<string[]>;
  listKnownActions: (route: string | null) => Promise<readonly KnownAction[]>;
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createReadPrimitiveHandlers(deps: ReadPrimitiveDependencies): Partial<Record<PrimitiveName, PrimitiveHandler>> {
  return {
    login: () => deps.login(),
    get_state: (_req, session) => deps.getState(session),
    read_auth_state: () => deps.readAuthState(),
    read_current_route: () => deps.readCurrentRoute(),
    read_known_routes: () => deps.readKnownRoutes(),
    read_goals_overview: () => deps.readGoalsOverview(),
    read_route_snapshot: (req) => deps.readRouteSnapshot(asOptionalString(req.payload?.route), asOptionalString(req.payload?.url)),
    read_page_sections: (req) => deps.readPageSections(asOptionalString(req.payload?.route), asOptionalString(req.payload?.url)),
    discover_links: (req) => deps.discoverLinks(asOptionalString(req.payload?.route), asOptionalString(req.payload?.url)),
    list_goals: (req) => deps.listGoals((req.payload?.filter as string | undefined) ?? "all"),
    discover_goals: (req) => deps.discoverGoals(req.payload?.waitMs),
    read_goal: (req) => deps.readGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_metadata: (req) => deps.readGoalMetadata(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_workspace: (req) => deps.readGoalWorkspace(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_full: (req) => deps.readGoalFull(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_status_details: (req) => deps.readGoalStatusDetails(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_cached_goals: () => deps.readCachedGoals(),
    read_cached_desires: () => deps.readCachedDesires(),
    read_task_panel_snapshot: (req) => deps.readTaskPanelSnapshot(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    survey_active_goal_task_states: () => deps.surveyActiveGoalTaskStates(),
    list_goal_tasks: (req) => deps.listGoalTasks(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_task_suggestions: (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("read_task_suggestions requires goalTitle");
      return deps.readTaskSuggestions(goalTitle);
    },
    read_goal_chat: (req) => deps.readGoalChat(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_understand_overview: () => deps.readUnderstandOverview(),
    read_level_check: () => deps.readLevelCheck(),
    read_life_history_assessment: () => deps.readLifeHistoryAssessment(),
    read_big_five_assessment: () => deps.readBigFiveAssessment(),
    read_lifestorming_overview: () => deps.readLifestormingOverview(),
    list_lifestorming_desires: () => deps.listLifestormingDesires(),
    read_lifestorming_category: (req) => deps.readLifestormingCategory(asOptionalString(req.payload?.category)),
    read_lifestorming_full: () => deps.readLifestormingFull(),
    read_sensation_practice: (req) => deps.readSensationPractice(asOptionalString(req.payload?.desireId), asOptionalString(req.payload?.desireTitle)),
    read_coach_messages: () => deps.readCoachMessages(),
    list_known_actions: (req) => deps.listKnownActions((req.payload?.route as string | undefined) ?? null)
  };
}
