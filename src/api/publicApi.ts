import type {
  InternalCachedDesiresResult,
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
import {
  isPublicCategory,
  normalizeChatHistory,
  normalizeTaskSummary,
  parseCompletionPercent,
  parseDueLabel,
  requirePublicCategory,
  requirePublicDueDate,
  sliceDepth,
  type InternalGoalListEntry,
  type InternalPrimitiveName
} from "./normalizers.js";

export type PublicTaskStatus = "pending" | "completed" | "unknown";
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
type PublicApiInputMap = {
  get_state: undefined;
  get_goals: { status?: PublicGoalStatus; category?: PublicCategory; deep?: boolean } | undefined;
  get_goal: { goalTitle: string; depth?: number };
  get_goal_tasks: { goalTitle: string };
  get_goal_chat: { goalTitle: string; depth?: number };
  get_desires: { deep?: boolean } | undefined;
  get_desire: { desireTitle: string };
  get_actions: undefined;
  talk_to_guide: { message: string };
  talk_to_goal_chat: { goalTitle: string; message: string };
  add_desires: { itemsByCategory: PublicAddDesiresInput["itemsByCategory"] };
  update_desires: { desires: PublicUpdateDesireItem[] };
  create_goals_from_desires: { desires: PublicCreateGoalFromDesireItem[] };
  create_goal: { title: string; category: PublicCategory; dueDate: PublicDueDate };
  update_goal: { goalTitle: string; status?: PublicGoalStatus; dueDate?: PublicDueDate };
  update_tasks: { goalTitle: string; updates: PublicTaskUpdate[] };
};

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

export class PublicApi {
  constructor(private readonly client: SelfMaxPlaywrightClient) {}

  async execute<Name extends PublicApiRequest["name"]>(
    req: Extract<PublicApiRequest, { name: Name }>,
    session: SessionContext
  ): Promise<PublicApiResponse<PublicApiResult<Name>>> {
    try {
      const result = await this.handle(req, session);
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
    req: Extract<PublicApiRequest, { name: Name }>,
    session: SessionContext
  ): Promise<PublicApiResult<Name>> {
    if (req.name !== "get_actions") {
      await this.execInternal(session, "login");
    }

    switch (req.name) {
      case "get_actions":
        return { actions: publicActions } as PublicApiResult<Name>;
      case "talk_to_guide": {
        const payload = req.payload as PublicApiInputMap["talk_to_guide"];
        return await this.talkToGuide(session, payload.message) as PublicApiResult<Name>;
      }
      case "talk_to_goal_chat": {
        const payload = req.payload as PublicApiInputMap["talk_to_goal_chat"];
        return await this.talkToGoalChat(session, payload.goalTitle, payload.message) as PublicApiResult<Name>;
      }
      case "add_desires": {
        const payload = req.payload as PublicApiInputMap["add_desires"];
        return await this.brainstormDesires(session, payload.itemsByCategory) as PublicApiResult<Name>;
      }
      case "update_desires": {
        const payload = req.payload as PublicApiInputMap["update_desires"];
        return await this.feelOutDesires(session, payload.desires) as PublicApiResult<Name>;
      }
      case "create_goals_from_desires": {
        const payload = req.payload as PublicApiInputMap["create_goals_from_desires"];
        return await this.createGoalsFromDesires(session, payload.desires) as PublicApiResult<Name>;
      }
      case "create_goal": {
        const payload = req.payload as PublicApiInputMap["create_goal"];
        return await this.createGoal(session, payload) as PublicApiResult<Name>;
      }
      case "update_goal": {
        const payload = req.payload as PublicApiInputMap["update_goal"];
        return await this.updateGoal(session, payload.goalTitle, {
          status: payload.status,
          dueDate: payload.dueDate
        }) as PublicApiResult<Name>;
      }
      case "update_tasks": {
        const payload = req.payload as PublicApiInputMap["update_tasks"];
        return await this.updateTasks(session, payload.goalTitle, payload.updates) as PublicApiResult<Name>;
      }
      case "get_goals": {
        const payload = (req.payload as PublicApiInputMap["get_goals"]) ?? {};
        return await this.getGoals(session, payload) as PublicApiResult<Name>;
      }
      case "get_goal": {
        const payload = req.payload as PublicApiInputMap["get_goal"];
        return await this.getGoal(session, payload.goalTitle, payload.depth) as PublicApiResult<Name>;
      }
      case "get_goal_tasks": {
        const payload = req.payload as PublicApiInputMap["get_goal_tasks"];
        return await this.getGoalTasks(session, payload.goalTitle) as PublicApiResult<Name>;
      }
      case "get_goal_chat": {
        const payload = req.payload as PublicApiInputMap["get_goal_chat"];
        return await this.getGoalChat(session, payload.goalTitle, payload.depth) as PublicApiResult<Name>;
      }
      case "get_desires": {
        const payload = req.payload as PublicApiInputMap["get_desires"] | undefined;
        return await this.getDesires(session, Boolean(payload?.deep)) as PublicApiResult<Name>;
      }
      case "get_desire": {
        const payload = req.payload as PublicApiInputMap["get_desire"];
        return await this.getDesire(session, payload.desireTitle) as PublicApiResult<Name>;
      }
      case "get_state":
        return await this.getState(session) as PublicApiResult<Name>;
      default:
        throw new Error(`unsupported public API action: ${String(req.name)}`);
    }
  }

  private async execInternal<Result>(session: SessionContext, name: InternalPrimitiveName, payload?: PrimitivePayload): Promise<Result> {
    const result = await this.client.execute({ id: `public-${name}-${Date.now()}`, name, payload }, session);
    if (!result.ok) throw new Error(result.error ?? `${name} failed`);
    return result.result as Result;
  }

  private async readCoachMessages(session: SessionContext): Promise<string[]> {
    return this.execInternal<string[]>(session, "read_coach_messages");
  }

  private async readGoalChatInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalChatResult> {
    return this.execInternal<InternalGoalChatResult>(session, "read_goal_chat", { goalTitle });
  }

  private async readGoalFullInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalFullResult> {
    return this.execInternal<InternalGoalFullResult>(session, "read_goal_full", { goalTitle });
  }

  private async readGoalStatusDetailsInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalStatusDetailsResult> {
    return this.execInternal<InternalGoalStatusDetailsResult>(session, "read_goal_status_details", { goalTitle }).catch(() => ({ details: [] }));
  }

  private async listGoalsInternal(session: SessionContext, filter: "active" | "complete" | "archived"): Promise<InternalGoalListResult> {
    return this.execInternal<InternalGoalListResult>(session, "list_goals", { filter });
  }

  private async listGoalTasksInternal(session: SessionContext, goalTitle: string): Promise<InternalGoalTasksResult> {
    return this.execInternal<InternalGoalTasksResult>(session, "list_goal_tasks", { goalTitle });
  }

  private async readLifestormingOverviewInternal(session: SessionContext): Promise<InternalLifestormingOverviewResult> {
    return this.execInternal<InternalLifestormingOverviewResult>(session, "read_lifestorming_overview");
  }

  private async readCachedDesiresInternal(session: SessionContext): Promise<InternalCachedDesiresResult> {
    return this.execInternal<InternalCachedDesiresResult>(session, "read_cached_desires").catch(() => ({ desires: [] }));
  }

  private async readSensationPracticeInternal(session: SessionContext, desireTitle: string): Promise<InternalSensationPracticeResult> {
    return this.execInternal<InternalSensationPracticeResult>(session, "read_sensation_practice", { desireTitle });
  }

  private async readLatestNewMessage(
    beforePromise: Promise<string[]>,
    action: () => Promise<void>,
    afterPromise: () => Promise<string[]>
  ): Promise<string> {
    const before = await beforePromise.catch((): string[] => []);
    await action();
    const after = await afterPromise();
    return after.find((entry) => !before.includes(entry)) ?? after.at(-1) ?? "";
  }

  private buildGoalSummaryBase(
    goal: Pick<InternalGoalListEntry, "title" | "category" | "dueLabel" | "progressLabel" | "taskPreviewItems">,
    status: PublicGoalStatus
  ): PublicGoalSummary {
    const title = String(goal?.title ?? "");
    const dueDate = parseDueLabel(goal?.dueLabel);
    return {
      title,
      category: requirePublicCategory(goal?.category, title),
      dueDate: requirePublicDueDate(dueDate, title),
      status,
      completionPercent: parseCompletionPercent(goal?.progressLabel),
      tasks: Array.isArray(goal?.taskPreviewItems)
        ? goal.taskPreviewItems.map((taskTitle: string) => ({ title: taskTitle, status: "unknown" as const }))
        : []
    };
  }

  private async listGoalsByStatus(session: SessionContext, status: PublicGoalStatus): Promise<InternalGoalListEntry[]> {
    const filter = status === "completed" ? "complete" : status;
    const listed = await this.listGoalsInternal(session, filter);
    return Array.isArray(listed.goals) ? listed.goals : [];
  }

  private async readDesireSummaries(session: SessionContext): Promise<{
    feltOutTitles: Set<string>;
    cachedByTitle: Map<string, { category?: PublicCategory }>;
    allTitles: string[];
  }> {
    const overview = await this.readLifestormingOverviewInternal(session);
    const cached = await this.readCachedDesiresInternal(session);
    const feltOutTitles = new Set<string>();
    const allTitles = new Set<string>();
    for (const section of overview.desiresBySection ?? []) {
      for (const item of section.items ?? []) {
        allTitles.add(item);
        if (section.section === "start_a_goal") feltOutTitles.add(item);
      }
    }
    for (const item of cached.desires ?? []) {
      if (item.title) allTitles.add(item.title);
    }
    const cachedByTitle = new Map<string, { category?: PublicCategory }>();
    for (const item of cached.desires ?? []) {
      if (!item.title) continue;
      cachedByTitle.set(item.title.toLowerCase(), {
        category: isPublicCategory(item.category) ? item.category : undefined
      });
    }
    return { feltOutTitles, cachedByTitle, allTitles: [...allTitles].sort((a, b) => a.localeCompare(b)) };
  }

  private async talkToGuide(session: SessionContext, message: string) {
    const response = await this.readLatestNewMessage(
      this.readCoachMessages(session),
      () => this.execInternal(session, "talk_to_guide", { message }),
      () => this.readCoachMessages(session)
    );
    return { response };
  }

  private async talkToGoalChat(session: SessionContext, goalTitle: string, message: string) {
    const response = await this.readLatestNewMessage(
      this.readGoalChatInternal(session, goalTitle).then((result) => result.messages ?? []),
      () => this.execInternal(session, "talk_to_goal_chat", { goalTitle, message }),
      async () => (await this.readGoalChatInternal(session, goalTitle)).messages ?? []
    );
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

  private async mapDeepGoal(session: SessionContext, goal: InternalGoalListEntry, status: PublicGoalStatus): Promise<PublicGoalSummary> {
    const full = await this.readGoalFullInternal(session, goal.title);
    const details = await this.readGoalStatusDetailsInternal(session, goal.title);
    const summary: PublicGoalSummary = {
      ...this.buildGoalSummaryBase(
        {
          title: String(full?.goalTitle ?? goal?.title ?? ""),
          category: full?.category ?? goal?.category,
          dueLabel: full?.dueLabel ?? goal?.dueLabel,
          progressLabel: full?.progressLabel ?? goal?.progressLabel,
          taskPreviewItems: goal?.taskPreviewItems
        },
        status
      ),
      tasks: Array.isArray(full?.tasks) ? full.tasks.map(normalizeTaskSummary) : this.buildGoalSummaryBase(goal, status).tasks
    };
    const chatHistory = normalizeChatHistory(full.messages);
    if (chatHistory.length > 0) summary.chatHistory = chatHistory;
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
  ): Promise<{ status: PublicGoalStatus; goal: InternalGoalListEntry }> {
    const statuses: PublicGoalStatus[] = ["active", "completed", "archived"];
    for (const status of statuses) {
      const listed = await this.listGoalsByStatus(session, status);
      const goal = listed.find((item) => String(item?.title ?? "").toLowerCase() === goalTitle.toLowerCase());
      if (goal) {
        return { status, goal };
      }
    }
    throw new Error(`goal not found: ${goalTitle}`);
  }

  private async getGoals(session: SessionContext, options: { status?: PublicGoalStatus; category?: PublicCategory; deep?: boolean }) {
    const status = options.status ?? "active";
    let goals = await this.listGoalsByStatus(session, status);
    if (options.category) {
      goals = goals.filter((goal) => goal?.category === options.category);
    }
    if (!options.deep) {
      return { goals: goals.map((goal) => this.buildGoalSummaryBase(goal, status)) };
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
    const messages = normalizeChatHistory(chat.messages, depth);
    return { goalTitle, messages };
  }

  private async getDesires(session: SessionContext, deep = false) {
    const { feltOutTitles, cachedByTitle, allTitles } = await this.readDesireSummaries(session);
    const desires: PublicDesireSummary[] = [];
    for (const title of allTitles) {
      const summary: PublicDesireSummary = {
        title,
        feltOut: feltOutTitles.has(title),
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
    const { feltOutTitles } = await this.readDesireSummaries(session);
      const detail = await this.readSensationPracticeInternal(session, desireTitle);
    const desire: PublicDesireSummary = {
      title: desireTitle,
      feltOut: feltOutTitles.has(desireTitle),
      category: detail?.category ? requirePublicCategory(detail.category, desireTitle) : undefined,
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
