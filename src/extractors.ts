import type { GoalStatusBlock, GoalSummary, LifestormingSection } from "./types.js";

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

  const instructionalNoise = /SELF-IMPROVE|SELF-AWARENESS|COMMUNITY|Help|More|LIFESTORMING|BRAINSTORM|YOUR LIFE|STEP \d+:|GO|VIEW|ADD TO GOALS|Now that you have a list of DESIRES|How would it feel\?|Spend a few minutes on your DESIRES|Or, you can delete it|Now you know how you feel!/i;
  const visibleDesires = lines.filter((line) => line.length > 2 && !instructionalNoise.test(line)).slice(0, 20);

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

  return {
    stepTexts,
    visibleDesires,
    desiresBySection: [
      { section: "feel_it_out", items: extractSectionItems(/^STEP 2:\s*FEEL IT OUT$/i, /^STEP 3:\s*START A GOAL$/i) },
      { section: "start_a_goal", items: extractSectionItems(/^STEP 3:\s*START A GOAL$/i, /^Self-Max is an AI-driven/i) }
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
  const index = selected ? lines.findIndex((line) => line === selected) : -1;
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
