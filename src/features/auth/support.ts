import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import { config } from "../../core/config.js";
import { textSelectors, selectors } from "../../platform/selectors.js";
import { AuthError } from "../../core/recovery.js";
import { waitForBoolean } from "../../core/postconditions.js";
import { resolveFirstVisible } from "../../platform/navigation.js";
import type { SessionContext } from "../../core/types.js";

export type AuthSupportDeps = {
  pageOrThrow: () => Page;
  context: () => BrowserContext | undefined;
};

export function createAuthSupport(deps: AuthSupportDeps) {
  return {
    async resolveChatInput(): Promise<Locator> {
      const page = deps.pageOrThrow();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const byPlaceholder = page.getByPlaceholder("Type your message...").first();
        if ((await byPlaceholder.count()) > 0) return byPlaceholder;

        const byTextboxRoleNamed = page.getByRole("textbox", { name: /message|guide|chat/i }).first();
        if ((await byTextboxRoleNamed.count()) > 0) return byTextboxRoleNamed;

        const byAnyTextboxRole = page.getByRole("textbox").first();
        if ((await byAnyTextboxRole.count()) > 0) return byAnyTextboxRole;

        const byConfiguredSelector = page.locator(config.COACH_INPUT_SELECTOR).first();
        if ((await byConfiguredSelector.count()) > 0) return byConfiguredSelector;

        const byContentEditable = page.locator('[contenteditable="true"]').first();
        if ((await byContentEditable.count()) > 0) return byContentEditable;

        const generic = page.locator("textarea, input[type='text'], input:not([type])").first();
        if ((await generic.count()) > 0) return generic;
        await page.waitForTimeout(250);
      }
      throw new Error("could not locate chat input");
    },

    async fillFirstAvailable(page: Page, selectorList: string[], value: string): Promise<void> {
      const input = await resolveFirstVisible(page, selectorList);
      await input.fill(value);
    },

    async readGoalCount(label: "Active" | "Complete" | "Archived" | "All"): Promise<number | null> {
      const page = deps.pageOrThrow();
      const node = page.getByText(new RegExp(`^${label}\\s*\\((\\d+)\\)$`, "i")).first();
      if ((await node.count()) === 0) return null;
      const text = ((await node.textContent()) || "").trim();
      const match = text.match(/\((\d+)\)/);
      return match ? Number(match[1]) : null;
    },

    async isGoalsWorkspaceVisible(): Promise<boolean> {
      const page = deps.pageOrThrow();
      const onGoalsUrl = /\/goals(\?|$)/.test(page.url());
      const anchorText = textSelectors(selectors.goals.workspaceAnchors);
      const anchor = page.getByText(new RegExp(escapeRegex(anchorText[0]), "i")).first();
      const categories = page.getByText(new RegExp(escapeRegex(anchorText[1]), "i")).first();
      const hasAnchorText = (await anchor.count()) > 0 || (await categories.count()) > 0;
      if (!(onGoalsUrl && hasAnchorText)) return false;

      const activeCount = await this.readGoalCount("Active");
      const archivedCount = await this.readGoalCount("Archived");
      const completeCount = await this.readGoalCount("Complete");
      const allCount = await this.readGoalCount("All");
      const counts = [activeCount, archivedCount, completeCount, allCount].filter((value): value is number => value !== null);
      if (counts.length === 0) return false;
      if (config.SELFMAX_AUTH_MIN_ARCHIVED > 0) {
        return (archivedCount ?? 0) >= config.SELFMAX_AUTH_MIN_ARCHIVED;
      }
      return counts.some((value) => value > 0);
    },

    async waitForGoalsWorkspaceVisible(timeoutMs = 4000): Promise<boolean> {
      const page = deps.pageOrThrow();
      try {
        await waitForBoolean(page, () => this.isGoalsWorkspaceVisible(), timeoutMs, "goals workspace did not become visible", 500);
        return true;
      } catch {
        return false;
      }
    },

    async ensureGoalsWorkspaceVisible(): Promise<void> {
      const page = deps.pageOrThrow();
      const ok = await this.waitForGoalsWorkspaceVisible();
      if (ok) return;
      const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      throw new AuthError(`login did not reach goals workspace (url=${page.url()} snippet=${snippet})`, {
        action: "reuse a validated long-lived session",
        detail: "goals workspace readiness never reached the visible goals dashboard state"
      });
    },

    async persistAuthState(): Promise<void> {
      const context = deps.context();
      if (!context) return;
      const dir = dirname(config.SELFMAX_STORAGE_STATE_PATH);
      mkdirSync(dir, { recursive: true });
      await context.storageState({ path: config.SELFMAX_STORAGE_STATE_PATH });
    },

    storageKeyFor(session: SessionContext): string {
      return `${config.SELFMAX_STATE_KEY}:${session.userId}:${session.sessionId}`;
    }
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
