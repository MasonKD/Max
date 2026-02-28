import type { PrimitiveName, PrimitiveRequest, SessionContext } from "./types.js";

export type PrimitiveHandler = (req: PrimitiveRequest, session: SessionContext) => Promise<unknown>;

export type ReadPrimitiveDependencies = {
  login: () => Promise<unknown>;
  getState: (session: SessionContext) => Promise<unknown>;
  readAuthState: () => Promise<unknown>;
  readCurrentRoute: () => Promise<unknown>;
  readKnownRoutes: () => Promise<unknown>;
  readGoalsOverview: () => Promise<unknown>;
  readRouteSnapshot: (route?: string, url?: string) => Promise<unknown>;
  readPageSections: (route?: string, url?: string) => Promise<unknown>;
  discoverLinks: (route?: string, url?: string) => Promise<unknown>;
  listGoals: (filter: string) => Promise<unknown>;
  discoverGoals: (waitMs?: unknown) => Promise<unknown>;
  discoverGoalIds: (waitMs?: unknown) => Promise<unknown>;
  readGoal: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  readGoalMetadata: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  readGoalWorkspace: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  readGoalFull: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  readCachedGoals: () => Promise<unknown>;
  readCachedDesires: () => Promise<unknown>;
  readTaskPanelSnapshot: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  surveyActiveGoalTaskStates: () => Promise<unknown>;
  listGoalTasks: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  readGoalChat: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  readLifestormingOverview: () => Promise<unknown>;
  listLifestormingDesires: () => Promise<unknown>;
  readLifestormingCategory: (category?: string) => Promise<unknown>;
  readLifestormingFull: () => Promise<unknown>;
  readSensationPractice: (desireId?: string, desireTitle?: string) => Promise<unknown>;
  readCoachMessages: () => Promise<unknown>;
  listKnownActions: (route: string | null) => Promise<unknown>;
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
    discover_goal_ids: (req) => deps.discoverGoalIds(req.payload?.waitMs),
    read_goal: (req) => deps.readGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_metadata: (req) => deps.readGoalMetadata(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_workspace: (req) => deps.readGoalWorkspace(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_full: (req) => deps.readGoalFull(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_cached_goals: () => deps.readCachedGoals(),
    read_cached_desires: () => deps.readCachedDesires(),
    read_task_panel_snapshot: (req) => deps.readTaskPanelSnapshot(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    survey_active_goal_task_states: () => deps.surveyActiveGoalTaskStates(),
    list_goal_tasks: (req) => deps.listGoalTasks(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_goal_chat: (req) => deps.readGoalChat(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    read_lifestorming_overview: () => deps.readLifestormingOverview(),
    list_lifestorming_desires: () => deps.listLifestormingDesires(),
    read_lifestorming_category: (req) => deps.readLifestormingCategory(asOptionalString(req.payload?.category)),
    read_lifestorming_full: () => deps.readLifestormingFull(),
    read_sensation_practice: (req) => deps.readSensationPractice(asOptionalString(req.payload?.desireId), asOptionalString(req.payload?.desireTitle)),
    read_coach_messages: () => deps.readCoachMessages(),
    list_known_actions: (req) => deps.listKnownActions((req.payload?.route as string | undefined) ?? null)
  };
}
