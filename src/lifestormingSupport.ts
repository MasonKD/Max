import type { Locator, Page } from "playwright";

export type LifestormingSupportDeps = {
  pageOrThrow: () => Page;
};

export function createLifestormingSupport(deps: LifestormingSupportDeps) {
  return {
    async waitForPageTextNotContaining(needle: string, timeoutMs = 2500, page = deps.pageOrThrow()): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        if (!text.includes(needle)) return;
        await page.waitForTimeout(250);
      }
    },

    async waitForDesiresCategory(category: string, timeoutMs = 2500, page = deps.pageOrThrow()): Promise<void> {
      const expected = category.trim().toUpperCase();
      const expectedPath = `/lifestorming/desires-selection/${category.trim().toLowerCase()}`;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const lines = (await page.locator("body").innerText().catch(() => "")).split(/\n+/).map((line) => line.trim()).filter(Boolean);
        const bodyText = lines.join(" ");
        if (!/Loading Desires/i.test(bodyText) && (page.url().includes(expectedPath) || lines.includes(expected))) return;
        await page.waitForTimeout(250);
      }
    },

    async resolveDesireInput(): Promise<Locator> {
      const page = deps.pageOrThrow();
      const byPlaceholder = page.getByPlaceholder("Add an item").first();
      if ((await byPlaceholder.count()) > 0) return byPlaceholder;
      const generic = page.locator("input[type='text'], input:not([type]), textarea").first();
      if ((await generic.count()) > 0) return generic;
      throw new Error("could not locate desire input");
    },

    async resolveRowByText(text: string, required = true): Promise<Locator | null> {
      const page = deps.pageOrThrow();
      const node = page.getByText(text, { exact: false }).first();
      if ((await node.count()) === 0) {
        if (!required) return null;
        throw new Error(`could not locate text: ${text}`);
      }
      return node.locator("xpath=ancestor::*[self::div or self::li or self::article or self::section][1]");
    }
  };
}
