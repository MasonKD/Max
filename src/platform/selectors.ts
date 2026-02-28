export type SelectorTier = "primary" | "fallback" | "legacy";

export type CssSelectorCandidate = {
  tier: SelectorTier;
  selector: string;
  note?: string;
};

export type TextSelectorCandidate = {
  tier: SelectorTier;
  text: string;
  note?: string;
};

export const selectors = {
  auth: {
    emailInput: [
      { tier: "primary", selector: 'input[type="email"]' },
      { tier: "fallback", selector: 'input[name*="email" i]' }
    ] satisfies CssSelectorCandidate[],
    passwordInput: [
      { tier: "primary", selector: 'input[type="password"]' },
      { tier: "fallback", selector: 'input[name*="password" i]' }
    ] satisfies CssSelectorCandidate[],
    submitButtons: [
      { tier: "primary", selector: 'button[type="submit"]' }
    ] satisfies CssSelectorCandidate[]
  },
  coach: {
    input: [
      { tier: "primary", selector: 'textarea[placeholder="Type your message..."]' },
      { tier: "fallback", selector: '[contenteditable="true"]' }
    ] satisfies CssSelectorCandidate[]
  },
  goals: {
    workspaceAnchors: [
      { tier: "primary", text: "WHAT DO YOU DESIRE TODAY?" },
      { tier: "fallback", text: "GOAL CATEGORIES" }
    ] satisfies TextSelectorCandidate[],
    createGoalOpeners: [
      { tier: "primary", text: "NEW GOAL" },
      { tier: "fallback", text: "I KNOW WHAT MY GOAL IS" }
    ] satisfies TextSelectorCandidate[],
    editActions: [
      { tier: "primary", text: "EDIT" },
      { tier: "fallback", text: "Edit" }
    ] satisfies TextSelectorCandidate[],
    cardOpenActions: [
      { tier: "primary", text: "START" }
    ] satisfies TextSelectorCandidate[],
    taskEntryActions: [
      { tier: "primary", text: "ADD TASKS" },
      { tier: "fallback", text: "Add Tasks" },
      { tier: "fallback", text: "Use the task suggestion tool" }
    ] satisfies TextSelectorCandidate[],
    statusActions: {
      completed: [
        { tier: "primary", text: "COMPLETE GOAL" },
        { tier: "fallback", text: "Complete Goal" }
      ] satisfies TextSelectorCandidate[],
      archived: [
        { tier: "primary", text: "ARCHIVE GOAL" },
        { tier: "fallback", text: "Archive Goal" }
      ] satisfies TextSelectorCandidate[],
      active: [
        { tier: "primary", text: "REACTIVATE GOAL" },
        { tier: "fallback", text: "Reactivate Goal" }
      ] satisfies TextSelectorCandidate[]
    }
  },
  tasks: {
    taskTab: [
      { tier: "primary", text: "TASKS" },
      { tier: "fallback", text: "Tasks" }
    ] satisfies TextSelectorCandidate[],
    panelAnchors: [
      { tier: "primary", text: "How will you accomplish" },
      { tier: "primary", text: "Add new task" },
      { tier: "fallback", text: "Use the task suggestion tool" }
    ] satisfies TextSelectorCandidate[]
  },
  lifestorming: {
    loadingAnchors: [
      { tier: "primary", text: "Loading Lifestorming Page..." },
      { tier: "fallback", text: "Loading Desires..." }
    ] satisfies TextSelectorCandidate[]
  }
} as const;

export function cssSelectors(candidates: readonly CssSelectorCandidate[]): string[] {
  return candidates.map((candidate) => candidate.selector);
}

export function textSelectors(candidates: readonly TextSelectorCandidate[]): string[] {
  return candidates.map((candidate) => candidate.text);
}
