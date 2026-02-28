import type {
  AssessmentQuestionState,
  AuthState,
  DiscoverGoalsResult,
  DiscoverLinksResult,
  GoalStatusDetail,
  GoalSummary,
  GoalsOverviewResult,
  InternalCachedDesiresResult,
  InternalGoalChatResult,
  InternalGoalFullResult,
  InternalGoalListResult,
  InternalGoalStatusDetailsResult,
  InternalGoalTasksResult,
  InternalLifestormingOverviewResult,
  InternalSensationPracticeResult,
  KnownRoutesResult,
  PrimitivePayload,
  PrimitiveName,
  PrimitiveRequest,
  RouteLocationResult,
  RouteSnapshotResult,
  PageSectionsResult,
  SessionContext
  ,
  StateSnapshot,
  TaskSuggestionsResult,
  UnderstandOverviewResult,
  LevelCheckResult,
} from "../core/types.js";

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
  | InternalGoalFullResult
  | InternalGoalStatusDetailsResult
  | InternalGoalTasksResult
  | InternalGoalChatResult
  | InternalCachedDesiresResult
  | InternalLifestormingOverviewResult
  | InternalSensationPracticeResult
  | { goals?: GoalSummary[] }
  | { details?: GoalStatusDetail[] }
  | AssessmentQuestionState
  | UnderstandOverviewResult
  | LevelCheckResult
  | TaskSuggestionsResult;

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
  readGoalFull: (goalTitle?: string, goalId?: string) => Promise<InternalGoalFullResult>;
  readGoalStatusDetails: (goalTitle?: string, goalId?: string) => Promise<InternalGoalStatusDetailsResult>;
  readCachedDesires: () => Promise<InternalCachedDesiresResult>;
  listGoalTasks: (goalTitle?: string, goalId?: string) => Promise<InternalGoalTasksResult>;
  readTaskSuggestions: (goalTitle: string) => Promise<TaskSuggestionsResult>;
  readGoalChat: (goalTitle?: string, goalId?: string) => Promise<InternalGoalChatResult>;
  readUnderstandOverview: () => Promise<UnderstandOverviewResult>;
  readLevelCheck: () => Promise<LevelCheckResult>;
  readLifeHistoryAssessment: () => Promise<AssessmentQuestionState>;
  readBigFiveAssessment: () => Promise<AssessmentQuestionState>;
  readLifestormingOverview: () => Promise<InternalLifestormingOverviewResult>;
  readSensationPractice: (desireId?: string, desireTitle?: string) => Promise<InternalSensationPracticeResult>;
  readCoachMessages: () => Promise<string[]>;
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
    read_goal_full: (req) => deps.readGoalFull(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_status_details: (req) => deps.readGoalStatusDetails(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_cached_desires: () => deps.readCachedDesires(),
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
    read_sensation_practice: (req) => deps.readSensationPractice(asOptionalString(req.payload?.desireId), asOptionalString(req.payload?.desireTitle)),
    read_coach_messages: () => deps.readCoachMessages()
  };
}
