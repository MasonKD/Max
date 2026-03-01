import type { InternalGoalListResult, PrimitiveName } from "../core/types.js";
import type { PublicCategory, PublicDueDate, PublicTaskStatus } from "./publicApi.js";

type InternalTaskLike = {
  text?: string;
  title?: string;
  completed?: boolean;
};

export type InternalGoalListEntry = NonNullable<InternalGoalListResult["goals"]>[number];

export function parseDueLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const match = label.match(/Due\s+(\d{2})\/(\d{2})\/(\d{2})/i);
  if (!match) return label;
  const year = Number(match[3]);
  const fullYear = year >= 70 ? 1900 + year : 2000 + year;
  return `${fullYear}-${match[1]}-${match[2]}`;
}

export function isPublicCategory(value: unknown): value is PublicCategory {
  return ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"].includes(String(value));
}

export function normalizePublicCategory(value: unknown): PublicCategory | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const mapping: Record<string, PublicCategory> = {
    health: "Health",
    work: "Work",
    love: "Love",
    family: "Family",
    social: "Social",
    fun: "Fun",
    dreams: "Dreams",
    meaning: "Meaning"
  };
  return mapping[normalized];
}

export function requirePublicCategory(value: unknown, entityTitle: string, entityKind: "goal" | "desire" = "goal"): PublicCategory {
  const normalized = normalizePublicCategory(value);
  if (!normalized) {
    throw new Error(`missing or invalid category for ${entityKind} "${entityTitle}"`);
  }
  return normalized;
}

export function requirePublicDueDate(value: unknown, goalTitle: string): PublicDueDate {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`missing due date for goal "${goalTitle}"`);
  }
  return value;
}

export function parseCompletionPercent(label: unknown): number | undefined {
  if (typeof label !== "string") return undefined;
  const percentMatch = label.match(/(\d+)%/);
  if (percentMatch?.[1]) return Number(percentMatch[1]);
  return undefined;
}

export function normalizeTaskStatus(completed: boolean | undefined): PublicTaskStatus {
  return completed === true ? "completed" : completed === false ? "pending" : "unknown";
}

export function normalizeTaskSummary(task: InternalTaskLike): { title: string; status: PublicTaskStatus } {
  return {
    title: String(task?.text ?? task?.title ?? ""),
    status: normalizeTaskStatus(task?.completed)
  };
}

export function normalizeChatHistory(messages: unknown[] | undefined, depth?: number): string[] {
  const normalized = Array.isArray(messages) ? messages.map((value) => String(value)).reverse() : [];
  return sliceDepth(normalized, depth);
}

export function sliceDepth<T>(items: T[], depth: number | undefined): T[] {
  if (depth === -1) return items;
  const normalized = typeof depth === "number" ? Math.max(0, depth) : 0;
  return items.slice(0, normalized + 1);
}

export const internalPrimitiveNames = [
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

export type InternalPrimitiveName = (typeof internalPrimitiveNames)[number];
