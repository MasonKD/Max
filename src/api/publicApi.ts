import type {
  InternalCachedDesiresResult,
  KnownActionInvocation,
  InternalGoalChatResult,
  InternalGoalFullResult,
  InternalGoalListResult,
  InternalGoalStatusDetailsResult,
  InternalGoalTasksResult,
  InternalLifestormingOverviewResult,
  InternalSensationPracticeResult,
  PrimitivePayload,
  PublicApiRequest,
  PublicApiResponse,
  SessionContext
} from "../core/types.js";
import type { SelfMaxPlaywrightClient } from "../client/index.js";

type PublicTaskStatus = "pending" | "completed" | "unknown";
export type PublicCategory = "Health" | "Work" | "Love" | "Family" | "Social" | "Fun" | "Dreams" | "Meaning";
export type PublicDueDate = string;
export type PublicGoalStatus = "active" | "completed" | "archived";

type PublicTaskSummary = {
  title: string;
  status: PublicTaskStatus;
};

type PublicAddDesiresInput = {
  itemsByCategory: Partial<Record<PublicCategory, string[]>>;
};

type PublicUpdateDesireItem = {
  title: string;
  notes: string;
};

type PublicCreateGoalFromDesireItem = {
  title: string;
  dueDate: PublicDueDate;
  goalTitle?: string;
  goalCategory?: PublicCategory;
};

type PublicTaskUpdate = {
  task: string;
  action: "add" | "complete" | "uncomplete" | "remove";
};

export type PublicGoalSummary = {
  title: string;
  category: PublicCategory;
  dueDate: PublicDueDate;
  status: PublicGoalStatus;
  completionPercent?: number;
  tasks?: PublicTaskSummary[];
  desire?: string;
  environment?: string;
  mentality?: string;
  actions?: string;
  situation?: string;
  feedback?: string;
  chatHistory?: string[];
};

export type PublicDesireSummary = {
  title: string;
  feltOut: boolean;
  category?: PublicCategory;
  sensationPracticeText?: string;
};

export type PublicAction = {
  name: PublicApiRequest["name"];
  mutating: boolean;
  description: string;
  input: string;
  output: string;
};

export type PublicApiResultMap = {
  get_state: { goals: PublicGoalSummary[]; desires: PublicDesireSummary[] };
  get_goals: { goals: PublicGoalSummary[] };
  get_goal: { goal: PublicGoalSummary };
  get_goal_tasks: { tasks: PublicTaskSummary[] };
  get_goal_chat: { goalTitle: string; messages: string[] };
  get_desires: { desires: PublicDesireSummary[] };
  get_desire: { desire: PublicDesireSummary };
  get_actions: { actions: PublicAction[] };
  talk_to_guide: { response: string };
  talk_to_goal_chat: { goalTitle: string; response: string };
  add_desires: { desires: PublicDesireSummary[]; addedCount: number };
  update_desires: { desires: PublicDesireSummary[] };
  create_goals_from_desires: { goals: PublicGoalSummary[] };
  create_goal: { goal: PublicGoalSummary };
  update_goal: {
    goal: PublicGoalSummary;
    applied: { goalTitle?: string; status?: PublicGoalStatus; dueDate?: PublicDueDate };
  };
  update_tasks: {
    goalTitle: string;
    applied: Array<{ task: string; action: string }>;
    tasks: PublicTaskSummary[];
  };
};

type PublicApiResult<Name extends PublicApiRequest["name"]> = PublicApiResultMap[Name];

const publicActions: PublicAction[] = [
  { name: "get_state", mutating: false, description: "Expensive full-state sweep across goals, tasks, desires, and chats.", input: "{}", output: "{ goals: PublicGoalSummary[]; desires: PublicDesireSummary[] }" },
  { name: "get_goals", mutating: false, description: "List goals by status/category with optional deep inspection.", input: "{ status?: PublicGoalStatus; category?: PublicCategory; deep?: boolean }", output: "{ goals: PublicGoalSummary[] }" },
  { name: "get_goal", mutating: false, description: "Read one goal with optional chat depth.", input: "{ goalTitle: string; depth?: number }", output: "{ goal: PublicGoalSummary }" },
  { name: "get_goal_tasks", mutating: false, description: "List tasks for one goal.", input: "{ goalTitle: string }", output: "{ tasks: PublicTaskSummary[] }" },
  { name: "get_goal_chat", mutating: false, description: "Read chat history for one goal.", input: "{ goalTitle: string; depth?: number }", output: "{ goalTitle: string; messages: string[] }" },
  { name: "get_desires", mutating: false, description: "List desires with optional deep sensation-practice reads.", input: "{ deep?: boolean }", output: "{ desires: PublicDesireSummary[] }" },
  { name: "get_desire", mutating: false, description: "Read one desire including sensation-practice data.", input: "{ desireTitle: string }", output: "{ desire: PublicDesireSummary }" },
  { name: "get_actions", mutating: false, description: "List public endpoints.", input: "{}", output: "{ actions: PublicAction[] }" },
  { name: "talk_to_guide", mutating: true, description: "Send a message to the guide and return the latest response.", input: "{ message: string }", output: "{ response: string }" },
  { name: "talk_to_goal_chat", mutating: true, description: "Send a message in a goal chat and return the latest response.", input: "{ goalTitle: string; message: string }", output: "{ goalTitle: string; response: string }" },
  { name: "add_desires", mutating: true, description: "Create desires across lifestorming categories.", input: "{ itemsByCategory: Partial<Record<PublicCategory, string[]>> }", output: "{ desires: PublicDesireSummary[]; addedCount: number }" },
  { name: "update_desires", mutating: true, description: "Persist sensation-practice notes for one or more desires.", input: "{ desires: Array<{ title: string; notes: string }> }", output: "{ desires: PublicDesireSummary[] }" },
  { name: "create_goals_from_desires", mutating: true, description: "Create goals from existing desires.", input: "{ desires: Array<{ title: string; dueDate: PublicDueDate; goalTitle?: string; goalCategory?: PublicCategory }> }", output: "{ goals: PublicGoalSummary[] }" },
  { name: "create_goal", mutating: true, description: "Create a goal directly.", input: "{ title: string; category: PublicCategory; dueDate: PublicDueDate }", output: "{ goal: PublicGoalSummary }" },
  { name: "update_goal", mutating: true, description: "Update goal status and/or due date.", input: "{ goalTitle: string; status?: PublicGoalStatus; dueDate?: PublicDueDate }", output: "{ goal: PublicGoalSummary; applied: { goalTitle: string; status?: PublicGoalStatus; dueDate?: PublicDueDate } }" },
  { name: "update_tasks", mutating: true, description: "Apply add/complete/uncomplete/remove actions to tasks within a goal.", input: "{ goalTitle: string; updates: Array<{ task: string; action: \"add\" | \"complete\" | \"uncomplete\" | \"remove\" }> }", output: "{ goalTitle: string; applied: Array<{ task: string; action: string }>; tasks: PublicTaskSummary[] }" }
];

function parseDueLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const match = label.match(/Due\s+(\d{2})\/(\d{2})\/(\d{2})/i);
  if (!match) return label;
  const year = Number(match[3]);
  const fullYear = year >= 70 ? 1900 + year : 2000 + year;
  return `${fullYear}-${match[1]}-${match[2]}`;
}

function isPublicCategory(value: unknown): value is PublicCategory {
  return ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"].includes(String(value));
}

function requirePublicCategory(value: unknown, goalTitle: string): PublicCategory {
  if (!isPublicCategory(value)) {
    throw new Error(`missing or invalid category for goal "${goalTitle}"`);
  }
  return value;
}

function requirePublicDueDate(value: unknown, goalTitle: string): PublicDueDate {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`missing due date for goal "${goalTitle}"`);
  }
  return value;
}

function parseCompletionPercent(label: unknown): number | undefined {
  if (typeof label !== "string") return undefined;
  const percentMatch = label.match(/(\d+)%/);
  if (percentMatch?.[1]) return Number(percentMatch[1]);
  return undefined;
}

function normalizeTaskSummary(task: any): PublicTaskSummary {
  return {
    title: String(task?.text ?? task?.title ?? ""),
    status: task?.completed === true ? "completed" : task?.completed === false ? "pending" : "unknown"
  };
}

function sliceDepth<T>(items: T[], depth: number | undefined): T[] {
  if (depth === -1) return items;
  const normalized = typeof depth === "number" ? Math.max(0, depth) : 0;
  return items.slice(-(normalized + 1));
}

export class PublicApi {
  constructor(private readonly client: SelfMaxPlaywrightClient) {}

  async execute<Name extends PublicApiRequest["name"]>(
    req: Extract<PublicApiRequest, { name: Name }> | PublicApiRequest,
    session: SessionContext
  ): Promise<PublicApiResponse<PublicApiResult<Name>>> {
    try {
      const result = await this.handle(req as Extract<PublicApiRequest, { name: Name }>, session);
      return { id: req.id, ok: true, result };
    } catch (error) {
      return {
        id: req.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async handle<Name extends PublicApiRequest["name"]>(
    req: Extract<PublicApiRequest, { name: Name }> | PublicApiRequest,
    session: SessionContext
  ): Promise<PublicApiResult<Name>> {
    if (req.name !== "get_actions") {
      await this.execInternal(session, "login");
    }

    switch (req.name) {
      case "get_actions":
        return { actions: publicActions } as PublicApiResult<Name>;
      case "talk_to_guide":
        return await this.talkToGuide(session, String(req.payload?.message ?? "")) as PublicApiResult<Name>;
      case "talk_to_goal_chat":
        return await this.talkToGoalChat(session, String(req.payload?.goalTitle ?? ""), String(req.payload?.message ?? "")) as PublicApiResult<Name>;
      case "add_desires":
        return await this.brainstormDesires(session, (req.payload?.itemsByCategory as PublicAddDesiresInput["itemsByCategory"]) ?? {}) as PublicApiResult<Name>;
      case "update_desires":
        return await this.feelOutDesires(session, (req.payload?.desires as PublicUpdateDesireItem[]) ?? []) as PublicApiResult<Name>;
      case "create_goals_from_desires":
        return await this.createGoalsFromDesires(session, (req.payload?.desires as PublicCreateGoalFromDesireItem[]) ?? []) as PublicApiResult<Name>;
      case "create_goal":
        return await this.createGoal(session, {
          title: String(req.payload?.title ?? ""),
          category: req.payload?.category as PublicCategory,
          dueDate: String(req.payload?.dueDate ?? "")
        }) as PublicApiResult<Name>;
      case "update_goal":
        return await this.updateGoal(session, String(req.payload?.goalTitle ?? ""), {
          status: req.payload?.status as PublicGoalStatus | undefined,
          dueDate: typeof req.payload?.dueDate === "string" ? req.payload.dueDate : undefined
        }) as PublicApiResult<Name>;
      case "update_tasks":
        return await this.updateTasks(session, String(req.payload?.goalTitle ?? ""), (req.payload?.updates as PublicTaskUpdate[]) ?? []) as PublicApiResult<Name>;
      case "get_goals":
        return await this.getGoals(session, {
          status: req.payload?.status as PublicGoalStatus | undefined,
          category: req.payload?.category as PublicCategory | undefined,
          deep: Boolean(req.payload?.deep)
        }) as PublicApiResult<Name>;
      case "get_goal":
        return await this.getGoal(session, String(req.payload?.goalTitle ?? ""), req.payload?.depth as number | undefined) as PublicApiResult<Name>;
      case "get_goal_tasks":
        return await this.getGoalTasks(session, String(req.payload?.goalTitle ?? "")) as PublicApiResult<Name>;
      case "get_goal_chat":
        return await this.getGoalChat(session, String(req.payload?.goalTitle ?? ""), req.payload?.depth as number | undefined) as PublicApiResult<Name>;
      case "get_desires":
        return await this.getDesires(session, Boolean(req.payload?.deep)) as PublicApiResult<Name>;
      case "get_desire":
        return await this.getDesire(session, String(req.payload?.desireTitle ?? "")) as PublicApiResult<Name>;
      case "get_state":
        return await this.getState(session) as PublicApiResult<Name>;
      default:
        throw new Error(`unsupported public API action: ${String(req.name)}`);
    }
  }

  private async execInternal(session: SessionContext, name: string, payload?: PrimitivePayload | KnownActionInvocation): Promise<unknown> {
    const result = await this.client.execute({ id: `public-${name}-${Date.now()}`, name: name as any, payload }, session);
    if (!result.ok) throw new Error(result.error ?? `${name} failed`);
    return result.result;
  }

  private async readCoachMessages(session: SessionContext): Promise<string[]> {
    return await this.execInternal(session, "read_coach_messages") as string[];
  }

  private async readGoalChatInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalChatResult> {
    return await this.execInternal(session, "read_goal_chat", { goalTitle }) as InternalGoalChatResult;
  }

  private async readGoalFullInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalFullResult> {
    return await this.execInternal(session, "read_goal_full", { goalTitle }) as InternalGoalFullResult;
  }

  private async readGoalStatusDetailsInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalStatusDetailsResult> {
    return await this.execInternal(session, "read_goal_status_details", { goalTitle }).catch(() => ({ details: [] })) as InternalGoalStatusDetailsResult;
  }

  private async listGoalsInternal(session: SessionContext, filter: "active" | "complete" | "archived"): Promise<InternalGoalListResult> {
    return await this.execInternal(session, "list_goals", { filter }) as InternalGoalListResult;
  }

  private async listGoalTasksInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalTasksResult> {
    return await this.execInternal(session, "list_goal_tasks", { goalTitle }) as InternalGoalTasksResult;
  }

  private async readLifestormingOverviewInternal(session: SessionContext): Promise<InternalLifestormingOverviewResult> {
    return await this.execInternal(session, "read_lifestorming_overview") as InternalLifestormingOverviewResult;
  }

  private async readCachedDesiresInternal(session: SessionContext): Promise<InternalCachedDesiresResult> {
    return await this.execInternal(session, "read_cached_desires").catch(() => ({ desires: [] })) as InternalCachedDesiresResult;
  }

  private async readSensationPracticeInternal(session: SessionContext, desireTitle: string): Promise<InternalSensationPracticeResult> {
    return await this.execInternal(session, "read_sensation_practice", { desireTitle }) as InternalSensationPracticeResult;
  }

  private async talkToGuide(session: SessionContext, message: string) {
    const before = await this.readCoachMessages(session).catch((): string[] => []);
    await this.execInternal(session, "talk_to_guide", { message });
    const after = await this.readCoachMessages(session);
    const response = after.find((entry) => !before.includes(entry)) ?? after.at(-1) ?? "";
    return { response };
  }

  private async talkToGoalChat(session: SessionContext, goalTitle: string, message: string) {
    const before = await this.readGoalChatInternal(session, goalTitle).catch((): InternalGoalChatResult => ({ messages: [] }));
    await this.execInternal(session, "talk_to_goal_chat", { goalTitle, message });
    const after = await this.readGoalChatInternal(session, goalTitle);
    const afterMessages = Array.isArray(after.messages) ? after.messages : [];
    const beforeMessages = Array.isArray(before.messages) ? before.messages : [];
    const response = afterMessages.find((entry) => !beforeMessages.includes(entry)) ?? afterMessages.at(-1) ?? "";
    return { goalTitle, response };
  }

  private async brainstormDesires(session: SessionContext, itemsByCategory: PublicAddDesiresInput["itemsByCategory"]) {
    await this.execInternal(session, "brainstorm_desires_for_each_category", { itemsByCategory });
    const desires = await this.getDesires(session, false);
    const requested = Object.values(itemsByCategory).flatMap((value) => Array.isArray(value) ? value : []);
    return { desires: desires.desires, addedCount: requested.length };
  }

  private async feelOutDesires(session: SessionContext, desires: PublicUpdateDesireItem[]) {
    await this.execInternal(session, "feel_out_desires", { desires });
    const updated = [];
    for (const desire of desires) {
      const title = desire.title;
      if (!title) continue;
      const detail = await this.getDesire(session, title);
      updated.push(detail.desire);
    }
    return { desires: updated };
  }

  private async createGoalsFromDesires(session: SessionContext, desires: PublicCreateGoalFromDesireItem[]) {
    await this.execInternal(session, "create_goals_from_desires", { desires });
    const goals = [];
    for (const item of desires) {
      const goalTitle = item.goalTitle ?? item.title;
      if (!goalTitle) continue;
      const goal = await this.getGoal(session, goalTitle, 0);
      goals.push(goal.goal);
    }
    return { goals };
  }

  private async createGoal(session: SessionContext, input: { title: string; category: PublicCategory; dueDate: PublicDueDate }) {
    await this.execInternal(session, "create_goal", input);
    const goal = await this.getGoal(session, input.title, 0);
    return { goal: goal.goal };
  }

  private async updateGoal(session: SessionContext, goalTitle: string, updates: { status?: PublicGoalStatus; dueDate?: PublicDueDate }) {
    const applied = await this.execInternal(session, "update_goal", { goalTitle, ...updates }) as { goalTitle?: string; status?: PublicGoalStatus; dueDate?: PublicDueDate };
    const goal = await this.getGoal(session, goalTitle, 0);
    return { goal: goal.goal, applied };
  }

  private async updateTasks(session: SessionContext, goalTitle: string, updates: PublicTaskUpdate[]) {
    const grouped = new Map<string, string[]>();
    for (const update of updates) {
      const task = String(update.task ?? "");
      const action = String(update.action ?? "");
      if (!grouped.has(action)) grouped.set(action, []);
      grouped.get(action)!.push(task);
    }
    if (grouped.has("add")) {
      await this.execInternal(session, "add_tasks", { goalTitle, tasks: grouped.get("add") });
    }
    if (grouped.has("complete")) {
      await this.execInternal(session, "complete_task", { goalTitle, taskTexts: grouped.get("complete") });
    }
    if (grouped.has("uncomplete")) {
      await this.execInternal(session, "uncomplete_task", { goalTitle, taskTexts: grouped.get("uncomplete") });
    }
    if (grouped.has("remove")) {
      await this.execInternal(session, "remove_task", { goalTitle, taskTexts: grouped.get("remove") });
    }
    const tasks = await this.getGoalTasks(session, goalTitle);
    return {
      goalTitle,
      applied: updates.map((update) => ({ task: String(update.task ?? ""), action: String(update.action ?? "") })),
      tasks: tasks.tasks
    };
  }

  private mapShallowGoal(goal: any, status: PublicGoalStatus): PublicGoalSummary {
    const previewTasks = Array.isArray(goal?.taskPreviewItems)
      ? goal.taskPreviewItems.map((title: string) => ({ title, status: "unknown" as const }))
      : [];
    const title = String(goal?.title ?? "");
    const dueDate = parseDueLabel(goal?.dueLabel);
    return {
      title,
      category: requirePublicCategory(goal?.category, title),
      dueDate: requirePublicDueDate(dueDate, title),
      status,
      completionPercent: parseCompletionPercent(goal?.progressLabel),
      tasks: previewTasks
    };
  }

  private async mapDeepGoal(session: SessionContext, goal: any, status: PublicGoalStatus): Promise<PublicGoalSummary> {
    const full = await this.readGoalFullInternal(session, goal.title);
    const details = await this.readGoalStatusDetailsInternal(session, goal.title);
    const messages = Array.isArray(full.messages) ? full.messages.map((value) => String(value)).reverse() : [];
    const title = String(goal?.title ?? full?.goalTitle ?? "");
    const dueDate = parseDueLabel(full?.dueLabel ?? goal?.dueLabel);
    const summary: PublicGoalSummary = {
      title,
      category: requirePublicCategory(full?.category ?? goal?.category, title),
      dueDate: requirePublicDueDate(dueDate, title),
      status,
      completionPercent: parseCompletionPercent(full?.progressLabel ?? goal?.progressLabel),
      tasks: Array.isArray(full?.tasks) ? full.tasks.map(normalizeTaskSummary) : (this.mapShallowGoal(goal, status).tasks ?? [])
    };
    if (messages.length > 0) summary.chatHistory = messages;
    const detailMap = new Map(
      (details.details ?? [])
        .map((detail) => [String(detail.key ?? "").toLowerCase(), detail])
    );
    const assignIfNonDefault = (key: string, target: keyof PublicGoalSummary) => {
      const detail = detailMap.get(key);
      const state = typeof detail?.state === "string" ? detail.state.trim() : "";
      const summaryText = typeof detail?.summary === "string" ? detail.summary.trim() : "";
      if (summaryText) summary[target] = summaryText as never;
      else if (state && !/Not yet updated/i.test(state)) summary[target] = state as never;
    };
    assignIfNonDefault("desire", "desire");
    assignIfNonDefault("environment", "environment");
    assignIfNonDefault("mentality", "mentality");
    assignIfNonDefault("actions", "actions");
    assignIfNonDefault("situation", "situation");
    assignIfNonDefault("feedback", "feedback");
    return summary;
  }

  private async resolveGoalStatusAndListEntry(
    session: SessionContext,
    goalTitle: string
  ): Promise<{ status: PublicGoalStatus; goal: any }> {
    const filters: Array<{ filter: "active" | "complete" | "archived"; status: PublicGoalStatus }> = [
      { filter: "active", status: "active" },
      { filter: "complete", status: "completed" },
      { filter: "archived", status: "archived" }
    ];
    for (const candidate of filters) {
      const listed = await this.listGoalsInternal(session, candidate.filter);
      const goal = (listed.goals ?? []).find((item) => String(item?.title ?? "").toLowerCase() === goalTitle.toLowerCase());
      if (goal) {
        return { status: candidate.status, goal };
      }
    }
    throw new Error(`goal not found: ${goalTitle}`);
  }

  private async getGoals(session: SessionContext, options: { status?: PublicGoalStatus; category?: PublicCategory; deep?: boolean }) {
    const filter = options.status === "completed" ? "complete" : options.status ?? "active";
    const status = options.status ?? "active";
    const listed = await this.listGoalsInternal(session, filter);
    let goals = Array.isArray(listed.goals) ? listed.goals : [];
    if (options.category) {
      goals = goals.filter((goal) => goal?.category === options.category);
    }
    if (!options.deep) {
      return { goals: goals.map((goal) => this.mapShallowGoal(goal, status)) };
    }
    const deepGoals: PublicGoalSummary[] = [];
    for (const goal of goals) {
      deepGoals.push(await this.mapDeepGoal(session, goal, status));
    }
    return { goals: deepGoals };
  }

  private async getGoal(session: SessionContext, goalTitle: string, depth = 0) {
    const resolved = await this.resolveGoalStatusAndListEntry(session, goalTitle);
    const full = await this.mapDeepGoal(session, resolved.goal, resolved.status);
    full.chatHistory = sliceDepth(full.chatHistory ?? [], depth);
    return { goal: full };
  }

  private async getGoalTasks(session: SessionContext, goalTitle: string) {
    const tasks = await this.listGoalTasksInternal(session, goalTitle);
    return {
      tasks: Array.isArray(tasks.tasks) ? tasks.tasks.map(normalizeTaskSummary) : []
    };
  }

  private async getGoalChat(session: SessionContext, goalTitle: string, depth = 0) {
    const chat = await this.readGoalChatInternal(session, goalTitle);
    const messages = sliceDepth((chat.messages ?? []).map((value) => String(value)), depth);
    return { goalTitle, messages };
  }

  private async getDesires(session: SessionContext, deep = false) {
    const overview = await this.readLifestormingOverviewInternal(session);
    const cached = await this.readCachedDesiresInternal(session);
    const feltOut = new Set<string>();
    const allTitles = new Set<string>();
    for (const section of overview.desiresBySection ?? []) {
      for (const item of section.items ?? []) {
        allTitles.add(item);
        if (section.section === "start_a_goal") feltOut.add(item);
      }
    }
    for (const item of cached.desires ?? []) {
      if (item.title) allTitles.add(item.title);
    }
    const cachedByTitle = new Map<string, { category?: PublicCategory }>();
    for (const item of cached.desires ?? []) {
      if (item.title) {
        cachedByTitle.set(item.title.toLowerCase(), {
          category: isPublicCategory(item.category) ? item.category : undefined
        });
      }
    }
    const desires: PublicDesireSummary[] = [];
    for (const title of allTitles) {
      const summary: PublicDesireSummary = {
        title,
        feltOut: feltOut.has(title),
        category: cachedByTitle.get(title.toLowerCase())?.category
      };
      if (deep) {
        const detail = await this.getDesire(session, title);
        desires.push(detail.desire);
      } else {
        desires.push(summary);
      }
    }
    desires.sort((a, b) => a.title.localeCompare(b.title));
    return { desires };
  }

  private async getDesire(session: SessionContext, desireTitle: string) {
    const overview = await this.readLifestormingOverviewInternal(session);
    const feltOut = (overview.desiresBySection ?? []).some((section) => section.section === "start_a_goal" && (section.items ?? []).includes(desireTitle));
    const detail = await this.readSensationPracticeInternal(session, desireTitle);
    const desire: PublicDesireSummary = {
      title: desireTitle,
      feltOut,
      category: isPublicCategory(detail?.category) ? detail.category : undefined,
      sensationPracticeText: typeof detail?.noteText === "string" ? detail.noteText : undefined
    };
    return { desire };
  }

  private async getState(session: SessionContext) {
    const groupedGoals = await Promise.all([
      this.getGoals(session, { status: "active", deep: true }),
      this.getGoals(session, { status: "completed", deep: true }),
      this.getGoals(session, { status: "archived", deep: true })
    ]);
    const goalsMap = new Map<string, PublicGoalSummary>();
    for (const bucket of groupedGoals) {
      for (const goal of bucket.goals) {
        goalsMap.set(goal.title.toLowerCase(), goal);
      }
    }
    const desires = await this.getDesires(session, true);
    return {
      goals: [...goalsMap.values()],
      desires: desires.desires
    };
  }
}
