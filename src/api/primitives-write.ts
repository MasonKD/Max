import type {
  KnownActionInvocation,
  PrimitiveName,
  PrimitiveRequest,
  SessionContext,
  StatePatch
} from "../core/types.js";
import type { PrimitiveHandler } from "./primitives-read.js";
import type { KnownRouteId } from "../platform/catalog.js";

export type PrimitiveWriteResult = object;

export type WritePrimitiveDependencies = {
  setState: (session: SessionContext, patch: StatePatch) => Promise<PrimitiveWriteResult>;
  talkToGuide: (message: string) => Promise<PrimitiveWriteResult>;
  talkToGoalChat: (message: string, goalTitle: string) => Promise<PrimitiveWriteResult>;
  sendCoachMessage: (message: string) => Promise<PrimitiveWriteResult>;
  brainstormDesiresForEachCategory: (itemsByCategory: StatePatch) => Promise<PrimitiveWriteResult>;
  feelOutDesires: (desires: unknown[]) => Promise<PrimitiveWriteResult>;
  createGoalsFromDesires: (desires: unknown[]) => Promise<PrimitiveWriteResult>;
  createGoal: (input: { title: string; category: string; dueDate: string }) => Promise<PrimitiveWriteResult>;
  updateGoal: (goalTitle: string, updates: { status?: "active" | "completed" | "archived"; dueDate?: string }) => Promise<PrimitiveWriteResult>;
  updateGoalDueDate: (goalTitle: string | undefined, goalId: string | undefined, dueDate: string) => Promise<PrimitiveWriteResult>;
  startGoal: (goalTitle?: string, goalId?: string) => Promise<PrimitiveWriteResult>;
  addTasks: (goalTitle: string | undefined, goalId: string | undefined, tasks: string[], useSuggestions: boolean) => Promise<PrimitiveWriteResult>;
  removeTask: (goalTitle: string | undefined, goalId: string | undefined, taskText: string) => Promise<PrimitiveWriteResult>;
  completeTask: (goalTitle: string | undefined, goalId: string | undefined, taskText: string) => Promise<PrimitiveWriteResult>;
  uncompleteTask: (goalTitle: string | undefined, goalId: string | undefined, taskText: string) => Promise<PrimitiveWriteResult>;
  completeGoal: (goalTitle?: string, goalId?: string) => Promise<PrimitiveWriteResult>;
  reactivateGoal: (goalTitle?: string, goalId?: string) => Promise<PrimitiveWriteResult>;
  archiveGoal: (goalTitle?: string, goalId?: string) => Promise<PrimitiveWriteResult>;
  deleteGoal: (goalTitle?: string, goalId?: string) => Promise<PrimitiveWriteResult>;
  deleteGoalApi: (goalId?: string) => Promise<PrimitiveWriteResult>;
  navigate: (route: KnownRouteId) => Promise<PrimitiveWriteResult>;
  invokeKnownAction: (payload: KnownActionInvocation) => Promise<PrimitiveWriteResult>;
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertUniqueStrings(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) throw new Error(`${label} must be unique: "${value}"`);
    seen.add(normalized);
  }
}

export function createWritePrimitiveHandlers(deps: WritePrimitiveDependencies): Partial<Record<PrimitiveName, PrimitiveHandler>> {
  return {
    set_state: (req, session) => deps.setState(session, req.payload ?? {}),
    talk_to_guide: (req) => deps.talkToGuide(String(req.payload?.message ?? "")),
    talk_to_goal_chat: (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("talk_to_goal_chat requires goalTitle");
      return deps.talkToGoalChat(String(req.payload?.message ?? ""), goalTitle);
    },
    send_coach_message: (req) => deps.sendCoachMessage(String(req.payload?.message ?? "")),
    brainstorm_desires_for_each_category: (req) => {
      const itemsByCategory = (req.payload?.itemsByCategory as StatePatch) ?? {};
      const requestedItems = Object.values(itemsByCategory)
        .flatMap((rawItems) => Array.isArray(rawItems) ? rawItems.map((value) => String(value).trim()).filter((value) => value.length > 0) : []);
      assertUniqueStrings(requestedItems, "desire titles");
      return deps.brainstormDesiresForEachCategory(itemsByCategory);
    },
    feel_out_desires: (req) => deps.feelOutDesires((req.payload?.desires as unknown[]) ?? []),
    create_goals_from_desires: (req) => {
      const desires = (req.payload?.desires as unknown[]) ?? [];
      const goalTitles = desires.map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return "";
        const obj = entry as { goalTitle?: unknown; title?: unknown };
        return String(obj.goalTitle ?? obj.title ?? "");
      }).filter((value) => value.trim().length > 0);
      assertUniqueStrings(goalTitles, "goal titles");
      return deps.createGoalsFromDesires(desires);
    },
    create_goal: (req) => {
      const category = asOptionalString(req.payload?.category);
      const dueDate = asOptionalString(req.payload?.dueDate);
      if (!category) throw new Error("create_goal requires category");
      if (!dueDate) throw new Error("create_goal requires dueDate");
      return deps.createGoal({
        title: String(req.payload?.title ?? ""),
        category,
        dueDate
      });
    },
    update_goal: (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("update_goal requires goalTitle");
      const status = asOptionalString(req.payload?.status);
      const dueDate = asOptionalString(req.payload?.dueDate);
      if (!status && !dueDate) throw new Error("update_goal requires status or dueDate");
      if (status && !["active", "completed", "archived"].includes(status)) {
        throw new Error(`update_goal invalid status: ${status}`);
      }
      return deps.updateGoal(goalTitle, { status: status as "active" | "completed" | "archived" | undefined, dueDate });
    },
    update_goal_due_date: (req) => {
      const dueDate = asOptionalString(req.payload?.dueDate);
      if (!dueDate) throw new Error("update_goal_due_date requires dueDate");
      return deps.updateGoalDueDate(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId), dueDate);
    },
    start_goal: (req) => deps.startGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    add_tasks: (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("add_tasks requires goalTitle");
      const tasks = ((req.payload?.tasks as unknown[]) ?? []).map((value) => String(value));
      assertUniqueStrings(tasks, "task titles within a goal");
      return deps.addTasks(goalTitle, undefined, tasks, false);
    },
    remove_task: async (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("remove_task requires goalTitle");
      const taskTexts = ((req.payload?.taskTexts as unknown[]) ?? []).map((value) => String(value));
      assertUniqueStrings(taskTexts, "task titles within a goal");
      if (taskTexts.length === 0) throw new Error("remove_task requires taskTexts");
      const removed: string[] = [];
      for (const taskText of taskTexts) {
        await deps.removeTask(goalTitle, undefined, taskText);
        removed.push(taskText);
      }
      return { goalTitle, removed };
    },
    complete_task: async (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("complete_task requires goalTitle");
      const taskTexts = ((req.payload?.taskTexts as unknown[]) ?? []).map((value) => String(value));
      assertUniqueStrings(taskTexts, "task titles within a goal");
      if (taskTexts.length === 0) throw new Error("complete_task requires taskTexts");
      const completed: string[] = [];
      for (const taskText of taskTexts) {
        await deps.completeTask(goalTitle, undefined, taskText);
        completed.push(taskText);
      }
      return { goalTitle, completed };
    },
    uncomplete_task: async (req) => {
      const goalTitle = asOptionalString(req.payload?.goalTitle);
      if (!goalTitle) throw new Error("uncomplete_task requires goalTitle");
      const taskTexts = ((req.payload?.taskTexts as unknown[]) ?? []).map((value) => String(value));
      assertUniqueStrings(taskTexts, "task titles within a goal");
      if (taskTexts.length === 0) throw new Error("uncomplete_task requires taskTexts");
      const uncompleted: string[] = [];
      for (const taskText of taskTexts) {
        await deps.uncompleteTask(goalTitle, undefined, taskText);
        uncompleted.push(taskText);
      }
      return { goalTitle, uncompleted };
    },
    complete_goal: (req) => deps.completeGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    reactivate_goal: (req) => deps.reactivateGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    archive_goal: (req) => deps.archiveGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    delete_goal: (req) => deps.deleteGoal(asOptionalString(req.payload?.goalTitle), asOptionalString(req.payload?.goalId)),
    delete_goal_api: (req) => deps.deleteGoalApi(asOptionalString(req.payload?.goalId)),
    navigate: (req) => deps.navigate((req.payload?.route as KnownRouteId | undefined) ?? "goals"),
    invoke_known_action: (req) => deps.invokeKnownAction(req.payload ?? {})
  };
}
