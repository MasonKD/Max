export const primitiveNames = [
  "login",
  "get_state",
  "set_state",
  "talk_to_guide",
  "talk_to_goal_chat",
  "send_coach_message",
  "read_coach_messages",
  "brainstorm_desires_for_each_category",
  "feel_out_desires",
  "create_goals_from_desires",
  "create_goal",
  "update_goal",
  "read_auth_state",
  "read_current_route",
  "read_known_routes",
  "read_goals_overview",
  "read_route_snapshot",
  "read_page_sections",
  "discover_links",
  "list_goals",
  "discover_goals",
  "read_goal",
  "read_goal_metadata",
  "read_goal_workspace",
  "read_goal_full",
  "read_goal_status_details",
  "read_cached_goals",
  "read_cached_desires",
  "read_task_panel_snapshot",
  "survey_active_goal_task_states",
  "list_goal_tasks",
  "read_task_suggestions",
  "read_goal_chat",
  "read_understand_overview",
  "read_level_check",
  "read_life_history_assessment",
  "read_big_five_assessment",
  "read_lifestorming_overview",
  "list_lifestorming_desires",
  "read_lifestorming_category",
  "read_lifestorming_full",
  "read_sensation_practice",
  "start_goal",
  "add_tasks",
  "remove_task",
  "complete_task",
  "uncomplete_task",
  "complete_goal",
  "reactivate_goal",
  "archive_goal",
  "delete_goal",
  "navigate",
  "list_known_actions",
  "invoke_known_action"
] as const;

export type PrimitiveName = (typeof primitiveNames)[number];

export const publicApiNames = [
  "get_state",
  "get_goals",
  "get_goal",
  "get_goal_tasks",
  "get_goal_chat",
  "get_desires",
  "get_desire",
  "get_actions",
  "talk_to_guide",
  "talk_to_goal_chat",
  "add_desires",
  "update_desires",
  "create_goals_from_desires",
  "create_goal",
  "update_goal",
  "update_tasks"
] as const;

export type PublicApiName = (typeof publicApiNames)[number];

export type JsonMap = Record<string, unknown>;
export type PrimitivePayload = JsonMap;
export type PublicApiPayload = JsonMap;
export type BridgePayload = JsonMap;
export type StateSnapshot = JsonMap;
export type StatePatch = JsonMap;
export type KnownActionInvocation = JsonMap;

export type PrimitiveRequest = {
  id: string;
  name: PrimitiveName;
  payload?: PrimitivePayload;
};

export type PublicApiRequest = {
  id: string;
  name: PublicApiName;
  payload?: PublicApiPayload;
};

export type PrimitiveResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type PublicApiResponse<Result = unknown> = {
  id: string;
  ok: boolean;
  result?: Result;
  error?: string;
};

export const busRoles = ["openclaw", "selfmax-bot", "end-user"] as const;

export type BusRole = (typeof busRoles)[number];

export const bridgeEnvelopeTypes = ["primitive", "api", "message", "ack", "error"] as const;

export type BridgeEnvelope = {
  type: (typeof bridgeEnvelopeTypes)[number];
  role: BusRole;
  correlationId: string;
  payload: BridgePayload;
};

export type SessionContext = {
  sessionId: string;
  userId: string;
};

export type GoalTaskPanelState = "tasks_present" | "add_tasks" | "empty";

export type AuthState = {
  valid: boolean;
  archivedCount: number | null;
  activeCount: number | null;
  completeCount: number | null;
  allCount: number | null;
};

export type GoalStatusBlock = {
  name: string;
  state: string;
  prompts: string[];
};

export type GoalStatusDetail = {
  name: string;
  key: string;
  checked: boolean;
  state: string;
  prompts: string[];
  summary?: string;
  updatedAt?: string | null;
  tooltip?: string;
};

export type TaskItem = {
  text: string;
  completed: boolean;
};

export type GoalSummary = {
  title: string;
  goalId?: string;
  category?: string;
  dueLabel?: string;
  progressLabel?: string;
  taskSummaryLabel?: string;
  taskPreviewItems?: string[];
  taskPanelState?: GoalTaskPanelState;
};

export type LifestormingSection = {
  section: "feel_it_out" | "start_a_goal";
  items: string[];
};

export type UnderstandCard = {
  title: string;
  subtitle?: string;
  href?: string;
  lastCompleted?: string;
  actionLabel?: string;
};

export type LevelCheckTopic = {
  domain: string;
  topic: string;
  actionLabel?: string;
};

export type AssessmentQuestionState = {
  title?: string;
  intro?: string;
  currentQuestion?: number;
  totalQuestions?: number;
  prompt?: string;
  wordsLabel?: string;
  minimumWords?: number | null;
  placeholder?: string;
  loading: boolean;
};

export type InternalGoalListResult = {
  goals?: GoalSummary[];
};

export type InternalGoalFullResult = {
  goalId?: string;
  goalTitle?: string;
  url?: string;
  workspaceVisible?: boolean;
  category?: string;
  dueLabel?: string;
  progressLabel?: string;
  statusBlocks?: GoalStatusBlock[];
  messages?: string[];
  tasks?: TaskItem[];
  taskReadReason?: string;
  snippet?: string;
};

export type InternalGoalStatusDetailsResult = {
  details?: GoalStatusDetail[];
};

export type InternalGoalTasksResult = {
  goalId?: string;
  goalTitle?: string;
  tasks?: TaskItem[];
  reason?: string;
};

export type InternalGoalChatResult = {
  goalId?: string;
  goalTitle?: string;
  messages?: string[];
};

export type InternalCachedDesireEntry = {
  desireId?: string;
  title?: string;
  category?: string;
  lastSeenAt?: string;
};

export type InternalCachedDesiresResult = {
  desires?: InternalCachedDesireEntry[];
};

export type InternalSensationPracticeResult = {
  desireId?: string;
  desireTitle?: string;
  category?: string;
  url?: string;
  prompts?: string[];
  actions?: string[];
  noteText?: string;
  snippet?: string;
};

export type InternalLifestormingOverviewResult = {
  url?: string;
  stepTexts?: string[];
  visibleDesires?: string[];
  desiresBySection?: LifestormingSection[];
  snippet?: string;
};

export type RouteLocationResult = {
  url: string;
  routeId?: string;
  params?: Record<string, string>;
};

export type KnownRoutesResult = Record<string, string>;

export type GoalsOverviewResult = {
  url?: string;
  auth?: AuthState;
  filterCounts?: Record<string, number>;
  categoryCounts?: Array<{ category: string; count: number }>;
  guidePrompt?: string;
  visibleGoals?: string[];
  snippet?: string;
};

export type RouteSnapshotResult = {
  url?: string;
  auth?: AuthState;
  headingCandidates?: string[];
  buttonTexts?: string[];
  inputPlaceholders?: string[];
  snippet?: string;
};

export type PageSectionsResult = {
  url?: string;
  routeId?: string;
  title?: string;
  headings?: string[];
  paragraphs?: string[];
  formLabels?: string[];
  buttons?: string[];
  links?: Array<{ text: string; href: string }>;
  snippet?: string;
};

export type DiscoverLinksResult = {
  url?: string;
  routeId?: string;
  links?: Array<{ text: string; href: string; routeId?: string }>;
};

export type DiscoverGoalsResult = {
  goals?: Array<{ goalId: string; title?: string }>;
  sources?: { domGoalIds: number; streamGoalIds: number };
  waitMs?: number;
  loadingVisible?: boolean;
};

export type DiscoverGoalIdsResult = {
  goalIds?: string[];
  waitMs?: number;
  loadingVisible?: boolean;
};

export type InternalGoalReadResult = {
  goalId?: string;
  goalTitle?: string;
  url?: string;
  workspaceVisible?: boolean;
  snippet?: string;
  statusBlocks?: GoalStatusBlock[];
};

export type InternalGoalMetadataResult = {
  goalId?: string;
  goalTitle?: string;
  url?: string;
  workspaceVisible?: boolean;
  category?: string;
  dueLabel?: string;
  progressLabel?: string;
  snippet?: string;
};

export type InternalGoalWorkspaceResult = {
  goalId?: string;
  goalTitle?: string;
  url?: string;
  workspaceVisible?: boolean;
  tabs?: string[];
  currentGoal?: string;
  snippet?: string;
};

export type InternalGoalSourceDocsResult = {
  desireDoc?: unknown;
  summaryDoc?: unknown;
  candidateDocs?: Array<{ path: string; result: unknown }>;
};

export type InternalCachedGoalsResult = {
  goals?: Array<{
    goalId?: string;
    title?: string;
    category?: string;
    dueLabel?: string;
    progressLabel?: string;
    taskSummaryLabel?: string;
    taskPreviewItems?: string[];
    taskPanelState?: GoalTaskPanelState;
    lastSeenAt?: string;
  }>;
};

export type InternalTaskPanelSnapshotResult = {
  goalId?: string;
  goalTitle?: string;
  url?: string;
  taskPanelVisible?: boolean;
  taskPanelText?: string;
  nearbyTexts?: string[];
  nearbyHtml?: string[];
  snippet?: string;
};

export type SurveyActiveGoalTaskStatesResult = {
  goals?: GoalSummary[];
  counts?: { tasks_present: number; add_tasks: number; empty: number };
};

export type TaskSuggestionsResult = {
  goalId?: string;
  goalTitle?: string;
  url?: string;
  suggestions?: string[];
};

export type UnderstandOverviewResult = {
  url?: string;
  routeId?: string;
  title?: string;
  intro?: string;
  cards?: UnderstandCard[];
  activity?: string[];
  snippet?: string;
};

export type LevelCheckResult = {
  url?: string;
  routeId?: string;
  title?: string;
  intro?: string[];
  pdfLabels?: string[];
  concepts?: string[];
  topics?: LevelCheckTopic[];
  snippet?: string;
};

export type LifestormingCategoryResult = {
  url?: string;
  category?: string;
  intro?: string;
  items?: string[];
  snippet?: string;
};

export type LifestormingDesiresListResult = {
  url?: string;
  buckets?: Array<{ category: string; items: string[] }>;
  snippet?: string;
};

export type LifestormingFullResult = {
  overview?: InternalLifestormingOverviewResult;
  buckets?: Array<{ category: string; items: string[] }>;
  categories?: Array<LifestormingCategoryResult>;
  cachedDesires?: InternalCachedDesireEntry[];
};
