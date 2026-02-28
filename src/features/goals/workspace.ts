import { extractGoalStatusBlocks, extractGoalTitleFromWorkspace, splitVisibleLines, normalizeWhitespace } from "../../platform/extractors.js";
import type { GoalStatusBlock } from "../../core/types.js";

export type GoalWorkspaceSnapshot = {
  goalTitle?: string;
  category?: string;
  dueLabel?: string;
  progressLabel?: string;
  statusBlocks: GoalStatusBlock[];
  tabs: string[];
  messages: string[];
  snippet: string;
};

export function extractGoalWorkspaceSnapshot(text: string): GoalWorkspaceSnapshot {
  const lines = splitVisibleLines(text);
  const categories = ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"];
  const goalTitle = extractGoalTitleFromWorkspace(text);
  const category = lines.find((line) => categories.includes(line));
  const dueLabel = lines.find((line) => /^Due\s/i.test(line));
  const progressLabel = lines.find((line) => /\d+\/\d+\s+tasks completed|\d+%/i.test(line));
  const tabs = lines.filter((line) => /^(BACK|EDIT|TASKS)$/i.test(line));

  let messages: string[] = [];
  const idx = lines.findIndex((line) => /Type your message/i.test(line));
  if (idx > 0) {
    messages = lines
      .slice(Math.max(0, idx - 12), idx)
      .filter(
        (line) =>
          line.length > 6 &&
          !/GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK|CURRENT GOAL|BACK|EDIT|TASKS/i.test(line)
      );
  } else {
    messages = lines.filter((line) => /hello|help you|goal of|important to you|guide you/i.test(line)).slice(-8);
  }

  return {
    goalTitle,
    category,
    dueLabel,
    progressLabel,
    statusBlocks: extractGoalStatusBlocks(text),
    tabs,
    messages,
    snippet: normalizeWhitespace(text).slice(0, 900)
  };
}
