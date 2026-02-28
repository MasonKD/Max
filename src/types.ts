export type PrimitiveName =
  | "login"
  | "get_state"
  | "set_state"
  | "talk_to_guide"
  | "talk_to_goal_chat"
  | "send_coach_message"
  | "read_coach_messages"
  | "brainstorm_desires_for_each_category"
  | "feel_out_desires"
  | "create_goals_from_desires"
  | "create_goal"
  | "read_auth_state"
  | "read_current_route"
  | "read_known_routes"
  | "read_goals_overview"
  | "read_route_snapshot"
  | "read_page_sections"
  | "discover_links"
  | "list_goals"
  | "discover_goals"
  | "discover_goal_ids"
  | "read_goal"
  | "read_goal_metadata"
  | "read_goal_workspace"
  | "read_goal_full"
  | "read_cached_goals"
  | "read_cached_desires"
  | "read_task_panel_snapshot"
  | "survey_active_goal_task_states"
  | "list_goal_tasks"
  | "read_goal_chat"
  | "read_lifestorming_overview"
  | "list_lifestorming_desires"
  | "read_lifestorming_category"
  | "read_lifestorming_full"
  | "read_sensation_practice"
  | "start_goal"
  | "add_tasks"
  | "remove_task"
  | "complete_task"
  | "uncomplete_task"
  | "complete_goal"
  | "archive_goal"
  | "delete_goal"
  | "delete_goal_api"
  | "navigate"
  | "list_known_actions"
  | "invoke_known_action";

export type PrimitiveRequest = {
  id: string;
  name: PrimitiveName;
  payload?: Record<string, unknown>;
};

export type PrimitiveResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type BusRole = "openclaw" | "selfmax-bot" | "end-user";

export type BridgeEnvelope = {
  type: "primitive" | "message" | "ack" | "error";
  role: BusRole;
  correlationId: string;
  payload: Record<string, unknown>;
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
