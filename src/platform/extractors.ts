import type { AssessmentQuestionState, GoalStatusBlock, GoalSummary, LifestormingSection, LevelCheckTopic, UnderstandCard } from "../core/types.js";
import type { TaskItem } from "../core/types.js";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function splitVisibleLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractGoalStatusBlocks(text: string): GoalStatusBlock[] {
  const names = ["DESIRE", "ENVIRONMENT", "MENTALITY", "ACTIONS", "SITUATION", "FEEDBACK"];
  const lines = splitVisibleLines(text);
  const blocks: GoalStatusBlock[] = [];

  for (const name of names) {
    const index = lines.findIndex((line) => line.toUpperCase() === name);
    if (index === -1) continue;
    const state = lines[index + 1] ?? "";
    const prompts: string[] = [];
    for (let i = index + 2; i < Math.min(lines.length, index + 8); i += 1) {
      const line = lines[i];
      if (names.includes(line.toUpperCase())) break;
      prompts.push(line);
    }
    blocks.push({ name, state, prompts });
  }

  return blocks;
}

export function extractGoalTitleFromWorkspace(text: string): string | undefined {
  const lines = splitVisibleLines(text);
  const marker = lines.findIndex((line) => /Current Goal/i.test(line));
  return marker === -1 ? undefined : lines[marker + 1] || undefined;
}

export function extractGoalsOverview(text: string): {
  filterCounts: Record<string, number>;
  categoryCounts: Array<{ category: string; count: number }>;
  guidePrompt?: string;
  visibleGoals: string[];
  snippet: string;
} {
  const lines = splitVisibleLines(text);
  const filterCounts: Record<string, number> = {};
  for (const match of text.matchAll(/\b(Active|Complete|Archived|All)\s*\((\d+)\)/gi)) {
    filterCounts[match[1].toLowerCase()] = Number(match[2]);
  }

  const categoryCounts: Array<{ category: string; count: number }> = [];
  const categories = ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"];
  for (let i = 0; i < lines.length; i += 1) {
    const category = categories.find((name) => lines[i].toLowerCase() === name.toLowerCase());
    if (!category) continue;
    const count = Number(lines[i - 1] ?? "");
    if (!Number.isNaN(count)) {
      categoryCounts.push({ category, count });
    }
  }

  const guidePrompt = lines.find((line) => /Don't know where to start|guide you towards one of your goals/i.test(line));
  const visibleGoals = lines.filter(
    (line) =>
      line.length > 2 &&
      !/SELF-IMPROVE|GET TO WORK ON A GOAL|SELF-AWARENESS|LEARN ABOUT YOURSELF AND GET BETTER GUIDANCE|COMMUNITY|JOIN OTHER SELF-MAXERS|\(AND HM\) ON DISCORD|GOAL CATEGORIES|YOUR GOALS|SHOW GOALS|NEW GOAL|LIFESTORMING|SELF-MAX GUIDE|DON'T KNOW WHERE TO START|HELP|MORE|Health|Work|Love|Family|Social|Fun|Dreams|Meaning|Active|Complete|Archived|All/i.test(
        line
      )
  ).slice(0, 20);

  return {
    filterCounts,
    categoryCounts,
    guidePrompt,
    visibleGoals,
    snippet: normalizeWhitespace(text).slice(0, 800)
  };
}

export function extractGoalSummariesFromText(text: string): GoalSummary[] {
  const lines = splitVisibleLines(text);
  const filters = new Set(["Active", "Complete", "Archived", "All"]);
  const categories = new Set(["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"]);
  const out: GoalSummary[] = [];
  let inGoals = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^YOUR GOALS$/i.test(line)) {
      inGoals = true;
      continue;
    }
    if (!inGoals) continue;
    if (filters.has(line.replace(/\s*\(\d+\)$/, "")) || /^SHOW GOALS:?$/i.test(line)) {
      continue;
    }
    if (/^No .* goals found\.?$/i.test(line)) {
      break;
    }

    const next = lines[i + 1] ?? "";
    const next2 = lines[i + 2] ?? "";
    const next3 = lines[i + 3] ?? "";
    if (!categories.has(next) || !/^Due\s/i.test(next2)) {
      continue;
    }

    const tail = lines.slice(i + 4, i + 20);
    const startIndex = tail.findIndex((entry) => /^START$/i.test(entry));
    const segment = startIndex === -1 ? tail : tail.slice(0, startIndex);
    const taskSummaryLabel = segment.find((entry) => /tasks completed|No tasks/i.test(entry));
    const hasExplicitAddTasks = segment.some((entry) => /^ADD TASKS$/i.test(entry));
    const taskPreviewItems = segment.filter(
      (entry) => entry !== taskSummaryLabel && !/^\d+%$/i.test(entry) && !/^ADD TASKS$/i.test(entry) && entry.length > 0
    );

    out.push({
      title: line,
      category: next,
      dueLabel: next2,
      progressLabel: /%|tasks completed/i.test(next3) ? next3 : undefined,
      taskSummaryLabel,
      taskPreviewItems: taskPreviewItems.slice(0, 12),
      taskPanelState: taskSummaryLabel && /tasks completed/i.test(taskSummaryLabel)
        ? "tasks_present"
        : hasExplicitAddTasks
          ? "add_tasks"
          : "empty"
    });
  }

  return dedupeGoalSummaries(out);
}

export function dedupeGoalSummaries(goals: GoalSummary[]): GoalSummary[] {
  const deduped = new Map<string, GoalSummary>();
  for (const goal of goals) {
    if (!deduped.has(goal.title)) {
      deduped.set(goal.title, goal);
    }
  }
  return [...deduped.values()];
}

export function extractLifestormingOverview(text: string): {
  stepTexts: string[];
  visibleDesires: string[];
  desiresBySection: LifestormingSection[];
  snippet: string;
} {
  const lines = splitVisibleLines(text);
  const stepTexts = lines.filter((line) => /^STEP\s+\d+:|^Step\s+\d+:|^LIFESTORMING$|^BRAINSTORM$|^YOUR LIFE$/i.test(line)).slice(0, 16);

  const extractSectionItems = (headingPattern: RegExp, stopPattern: RegExp): string[] => {
    const start = lines.findIndex((line) => headingPattern.test(line));
    if (start === -1) return [];
    const items: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (stopPattern.test(line)) break;
      if (
        /^GO$|^VIEW$|^ADD TO GOALS$|^BEGIN$|^No desires to practice yet\.?$|^No desires selected for final selection yet\.?$/i.test(line) ||
        /Now that you have a list of DESIRES|How would it feel\?|Spend a few minutes on your DESIRES|Or, you can delete it|Now you know how you feel!/i.test(line)
      ) {
        continue;
      }
      if (line.length > 1 && !/^STEP\s+\d+/i.test(line) && !/^LIFESTORMING$|^BRAINSTORM$|^YOUR LIFE$/i.test(line)) {
        items.push(line);
      }
    }
    return [...new Set(items)];
  };

  const feelItOutItems = extractSectionItems(/^STEP 2:\s*FEEL IT OUT$/i, /^STEP 3:\s*START A GOAL$/i);
  const startGoalItems = extractSectionItems(/^STEP 3:\s*START A GOAL$/i, /^Self-Max is an AI-driven/i);
  const visibleDesires = [...new Set([...feelItOutItems, ...startGoalItems])];

  return {
    stepTexts,
    visibleDesires,
    desiresBySection: [
      { section: "feel_it_out", items: feelItOutItems },
      { section: "start_a_goal", items: startGoalItems }
    ],
    snippet: normalizeWhitespace(text).slice(0, 800)
  };
}

export function extractLifestormingCategory(text: string, pathname: string): {
  category?: string;
  intro?: string;
  items: string[];
  snippet: string;
} {
  const lines = splitVisibleLines(text);
  const categories = ["HEALTH", "WORK", "LOVE", "FAMILY", "SOCIAL", "FUN", "DREAMS", "MEANING"];
  const pathMatch = pathname.match(/\/lifestorming\/desires-selection\/([^/?#]+)/i);
  const selectedFromPath = (pathMatch?.[1] || "").toUpperCase();
  const visibleCategories = lines.filter((line) => categories.includes(line.toUpperCase()) && line === line.toUpperCase());
  const selected = categories.includes(selectedFromPath) ? selectedFromPath : visibleCategories[visibleCategories.length - 1] || "";
  const index = selected ? lines.map((line, position) => ({ line, position })).filter((entry) => entry.line === selected).map((entry) => entry.position).pop() ?? -1 : -1;
  const intro = index !== -1 ? lines.slice(index + 1, index + 4).join(" ") : undefined;
  const items: string[] = [];

  if (index !== -1) {
    for (let i = index + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (categories.includes(line.toUpperCase()) && i !== index) break;
      if (/Add an item|^Add$|NEXT STEP|Spend a few minutes|Think of something|Click on a category|No items in this bucket yet/i.test(line)) {
        continue;
      }
      if (line.length > 1 && !/^[A-Z ]+$/.test(line)) {
        items.push(line);
      }
    }
  }

  return {
    category: selected || undefined,
    intro,
    items: [...new Set(items)],
    snippet: normalizeWhitespace(text).slice(0, 900)
  };
}

export function extractUnderstandOverview(text: string, links: Array<{ text: string; href: string }> = []): {
  title?: string;
  intro?: string;
  cards: UnderstandCard[];
  activity: string[];
  snippet: string;
} {
  const lines = splitVisibleLines(text);
  const titleIndex = lines.findIndex((line) => /SELF-AWARENESS/i.test(line) && /LEARN ABOUT YOURSELF/i.test(line));
  const intro = titleIndex !== -1 ? lines[titleIndex + 1] : undefined;
  const contentStartIndex = lines.findIndex((line) => /LEARN ABOUT YOURSELF \+ TELL SELF-MAX HOW TO HELP/i.test(line));
  const cards: UnderstandCard[] = [];
  const stopWords = /^(ACTIVITY|Self-Max is an AI-driven|Help|More)$/i;
  const actionIndices = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => /^(START|RETAKE|RESULTS|LOADING\.\.\.)$/i.test(entry.line));
  const linkQueue = links.filter((link) => /^(START|Loading\.\.\.)$/i.test(normalizeWhitespace(link.text)));
  const cardNoise = /^(SELF-IMPROVE|GET TO WORK ON A GOAL|SELF-AWARENESS|LEARN ABOUT YOURSELF AND GET BETTER GUIDANCE|COMMUNITY|JOIN OTHER SELF-MAXERS|\(AND HM\) ON DISCORD|LEARN ABOUT YOURSELF \+ TELL SELF-MAX HOW TO HELP)$/i;

  for (let position = 0; position < actionIndices.length; position += 1) {
    const { line: actionLabel, index } = actionIndices[position];
    const previousActionIndex = position > 0 ? actionIndices[position - 1].index : (contentStartIndex !== -1 ? contentStartIndex : titleIndex);
    const block = lines
      .slice((previousActionIndex ?? 0) + 1, index)
      .filter((line) => !/Help|More/i.test(line))
      .filter((line) => !cardNoise.test(line));
    const lastCompleted = block.find((entry) => /^LAST COMPLETED:/i.test(entry));
    const content = block.filter((entry) => !/^LAST COMPLETED:/i.test(entry) && !/^NEW$/i.test(entry));
    if (content.length === 0) continue;
    const title = content[0];
    const subtitle = content.slice(1).join(" ") || undefined;
    const href = linkQueue[position]?.href;
    cards.push({
      title: href?.includes("/level-check") && /GET TO WORK ON A GOAL/i.test(title) ? "LEVELCHECK" : title,
      subtitle: href?.includes("/level-check") && /GET TO WORK ON A GOAL/i.test(title) ? "TEST YOUR LEVEL OF THINKING" : subtitle,
      lastCompleted,
      actionLabel,
      href
    });
  }

  const activityIndex = lines.findIndex((line) => /^ACTIVITY$/i.test(line));
  const activity = activityIndex === -1
    ? []
    : lines
        .slice(activityIndex + 1)
        .filter((line) => !stopWords.test(line))
        .filter((line) => !/Self-Max is an AI-driven/i.test(line));

  return {
    title: titleIndex !== -1 ? lines[titleIndex] : undefined,
    intro,
    cards: cards.filter((card, index, all) => all.findIndex((candidate) => candidate.title === card.title) === index),
    activity,
    snippet: normalizeWhitespace(text).slice(0, 900)
  };
}

export function extractLevelCheck(text: string): {
  title?: string;
  intro: string[];
  pdfLabels: string[];
  concepts: string[];
  topics: LevelCheckTopic[];
  snippet: string;
} {
  const lines = splitVisibleLines(text);
  const title = lines.find((line) => /^LEVELCHECK$/i.test(line));
  const intro = lines.filter((line) => /TEST YOUR LEVEL OF THINKING|LEARN HOW TO GROW YOUR MIND|Talk to LEVELCHECK/i.test(line));
  const pdfLabels = lines.filter((line) => /^LEVELS /i.test(line));
  const concepts = lines.filter((line) => /^(COMPLETE|SANCTIFY|HARMONIZE|UNDERSTAND|ACHIEVE|BELONG|CONTROL|CONNECT|SURVIVE)$/i.test(line));

  const topics: LevelCheckTopic[] = [];
  const candidateTopics = ["Relationships", "Success", "Change", "Rules", "Personal Agency"];
  for (const topic of candidateTopics) {
    const actionMatch = text.match(new RegExp(`${topic}\\s+(START|RETAKE|RESULTS)`, "i"));
    if (actionMatch?.[1]) {
      topics.push({ domain: "LevelCheck", topic, actionLabel: actionMatch[1].toUpperCase() });
    }
  }

  return {
    title,
    intro,
    pdfLabels,
    concepts,
    topics: topics.filter((item, index, all) => all.findIndex((candidate) => candidate.domain === item.domain && candidate.topic === item.topic) === index),
    snippet: normalizeWhitespace(text).slice(0, 900)
  };
}

export function extractAssessmentQuestionState(text: string): AssessmentQuestionState {
  const lines = splitVisibleLines(text);
  const title = lines.find((line) => /WHO ARE YOU\?|BIG FIVE/i.test(line));
  const intro = lines.find((line) => /These questions are designed|Test Information|Self-Max will use this information/i.test(line));
  const progress = lines.find((line) => /^Question\s+\d+\s+of\s+\d+/i.test(line));
  const progressMatch = progress?.match(/Question\s+(\d+)\s+of\s+(\d+)/i);
  const prompt = progressMatch ? lines[lines.findIndex((line) => line === progress) + 1] : undefined;
  const wordsLabel = lines.find((line) => /^Words:\s*\d+\s*\/\s*\d+/i.test(line));
  const minimumMatch = wordsLabel?.match(/Minimum\s+(\d+)\s+words/i);

  return {
    title,
    intro,
    currentQuestion: progressMatch ? Number(progressMatch[1]) : undefined,
    totalQuestions: progressMatch ? Number(progressMatch[2]) : undefined,
    prompt,
    wordsLabel,
    minimumWords: minimumMatch ? Number(minimumMatch[1]) : null,
    placeholder: lines.find((line) => /Type your answer here/i.test(line)),
    loading: /Loading Test Information/i.test(text)
  };
}

export function extractSensationPractice(text: string): {
  title?: string;
  category?: string;
  prompts: string[];
  actions: string[];
  snippet: string;
} {
  const lines = splitVisibleLines(text);
  const categories = ["HEALTH", "WORK", "LOVE", "FAMILY", "SOCIAL", "FUN", "DREAMS", "MEANING"];
  const title = lines.find(
    (line) =>
      !categories.includes(line.toUpperCase()) &&
      !/Self-Max Logo|SELF-IMPROVE|GET TO WORK ON A GOAL|SELF-AWARENESS|LEARN ABOUT YOURSELF AND GET BETTER GUIDANCE|COMMUNITY|JOIN OTHER SELF-MAXERS|\(AND HM\) ON DISCORD|Help|More|SAVE|EXIT|DELETE DESIRE|Loading/i.test(line)
  );
  const category = lines.find((line) => categories.includes(line.toUpperCase()));
  const promptStart = lines.findIndex((line) => /Take a few minutes to think about adding this DESIRE/i.test(line));
  const prompts: string[] = [];
  if (promptStart !== -1) {
    for (let i = promptStart; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^(SAVE|EXIT|DELETE DESIRE)$/i.test(line)) break;
      prompts.push(line);
    }
  }

  return {
    title,
    category,
    prompts,
    actions: lines.filter((line) => /^(SAVE|EXIT|DELETE DESIRE)$/i.test(line)),
    snippet: normalizeWhitespace(text).slice(0, 1000)
  };
}

export function extractTaskItemsFromGoalPage(text: string): TaskItem[] {
  const lines = splitVisibleLines(text);
  const start = lines.findIndex((line) => /^How will you accomplish:/i.test(line));
  if (start === -1) {
    return [];
  }

  const endMarkers = [/^Add new task$/i, /^Use the task suggestion tool$/i, /^Close$/i, /^Tasks are generated based/i];
  const out: TaskItem[] = [];
  const seen = new Set<string>();

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (endMarkers.some((pattern) => pattern.test(line))) {
      break;
    }
    if (
      !line ||
      /^(Current Goal|GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK|BACK|EDIT|TASKS)$/i.test(line) ||
      /^How will you accomplish:/i.test(line)
    ) {
      continue;
    }

    const normalized = normalizeWhitespace(line);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: normalized, completed: false });
  }

  return out;
}
