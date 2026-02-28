import type { PrimitiveName } from "../core/types.js";

export const publicApiInternalPrimitives = [
  "login",
  "read_coach_messages",
  "read_goal_chat",
  "read_goal_full",
  "read_goal_status_details",
  "list_goals",
  "list_goal_tasks",
  "read_lifestorming_overview",
  "read_cached_desires",
  "read_sensation_practice",
  "talk_to_guide",
  "talk_to_goal_chat",
  "brainstorm_desires_for_each_category",
  "feel_out_desires",
  "create_goals_from_desires",
  "create_goal",
  "update_goal",
  "add_tasks",
  "complete_task",
  "uncomplete_task",
  "remove_task"
] as const satisfies readonly PrimitiveName[];

export const outOfScopePrivatePrimitives = [
  "read_auth_state",
  "read_current_route",
  "read_known_routes",
  "read_goals_overview",
  "read_route_snapshot",
  "read_page_sections",
  "discover_links",
  "discover_goals",
  "read_task_suggestions",
  "read_understand_overview",
  "read_level_check",
  "read_life_history_assessment",
  "read_big_five_assessment",
  "start_goal"
] as const satisfies readonly PrimitiveName[];
