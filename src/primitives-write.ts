import type { PrimitiveName, PrimitiveRequest, SessionContext } from "./types.js";
import type { PrimitiveHandler } from "./primitives-read.js";
import type { KnownRouteId } from "./catalog.js";

export type WritePrimitiveDependencies = {
  setState: (session: SessionContext, patch: Record<string, unknown>) => Promise<unknown>;
  talkToGuide: (message: string) => Promise<unknown>;
  talkToGoalChat: (message: string, goalTitle?: string) => Promise<unknown>;
  sendCoachMessage: (message: string) => Promise<unknown>;
  brainstormDesiresForEachCategory: (itemsByCategory: Record<string, unknown>) => Promise<unknown>;
  feelOutDesires: (desires: unknown[]) => Promise<unknown>;
  createGoalsFromDesires: (desires: unknown[]) => Promise<unknown>;
  createGoal: (input: { title: string; category?: string; dueDate?: string }) => Promise<unknown>;
  startGoal: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  addTasks: (goalTitle: string | undefined, goalId: string | undefined, tasks: string[], useSuggestions: boolean) => Promise<unknown>;
  removeTask: (goalTitle: string | undefined, goalId: string | undefined, taskText: string) => Promise<unknown>;
  completeTask: (goalTitle: string | undefined, goalId: string | undefined, taskText: string) => Promise<unknown>;
  uncompleteTask: (goalTitle: string | undefined, goalId: string | undefined, taskText: string) => Promise<unknown>;
  completeGoal: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  archiveGoal: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  deleteGoal: (goalTitle?: string, goalId?: string) => Promise<unknown>;
  deleteGoalApi: (goalId?: string) => Promise<unknown>;
  navigate: (route: KnownRouteId) => Promise<unknown>;
  invokeKnownAction: (payload: Record<string, unknown>) => Promise<unknown>;
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createWritePrimitiveHandlers(deps: WritePrimitiveDependencies): Partial<Record<PrimitiveName, PrimitiveHandler>> {
  return {
    set_state: (req, session) => deps.setState(session, req.payload ?? {}),
    talk_to_guide: (req) => deps.talkToGuide(String(req.payload?.message ?? "")),
    talk_to_goal_chat: (req) => deps.talkToGoalChat(String(req.payload?.message ?? ""), asOptionalString(req.payload?.goalTitle)),
    send_coach_message: (req) => deps.sendCoachMessage(String(req.payload?.message ?? "")),
    brainstorm_desires_for_each_category: (req) => deps.brainstormDesiresForEachCategory((req.payload?.itemsByCategory as Record<string, unknown>) ?? {}),
    feel_out_desires: (req) => deps.feelOutDesires((req.payload?.desires as unknown[]) ?? []),
    create_goals_from_desires: (req) => deps.createGoalsFromDesires((req.payload?.desires as unknown[]) ?? []),
    create_goal: (req) => deps.createGoal({
      title: String(req.payload?.title ?? ""),
      category: asOptionalString(req.payload?.category),
      dueDate: asOptionalString(req.payload?.dueDate)
    }),
    start_goal: (req) => deps.startGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    add_tasks: (req) => deps.addTasks(
      asOptionalString(req.payload?.goalTitle),
      asOptionalString(req.payload?.goalId),
      ((req.payload?.tasks as unknown[]) ?? []).map((value) => String(value)),
      Boolean(req.payload?.useSuggestions)
    ),
    remove_task: (req) => deps.removeTask(
      asOptionalString(req.payload?.goalTitle),
      asOptionalString(req.payload?.goalId),
      String(req.payload?.taskText ?? "")
    ),
    complete_task: (req) => deps.completeTask(
      asOptionalString(req.payload?.goalTitle),
      asOptionalString(req.payload?.goalId),
      String(req.payload?.taskText ?? "")
    ),
    uncomplete_task: (req) => deps.uncompleteTask(
      asOptionalString(req.payload?.goalTitle),
      asOptionalString(req.payload?.goalId),
      String(req.payload?.taskText ?? "")
    ),
    complete_goal: (req) => deps.completeGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    archive_goal: (req) => deps.archiveGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    delete_goal: (req) => deps.deleteGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    delete_goal_api: (req) => deps.deleteGoalApi(asOptionalString(req.payload?.goalId)),
    navigate: (req) => deps.navigate((req.payload?.route as KnownRouteId | undefined) ?? "goals"),
    invoke_known_action: (req) => deps.invokeKnownAction(req.payload ?? {})
  };
}
