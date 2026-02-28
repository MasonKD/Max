import type { BrowserContext, Locator, Page } from "playwright";
import type { SearchRoot } from "./navigation.js";
import { config } from "./config.js";
import { extractLifestormingCategory, extractLifestormingOverview, extractSensationPractice } from "./extractors.js";
import { extractRouteParams, titleCase } from "./navigation.js";
import { StateError } from "./recovery.js";
import { LIFESTORMING_CATEGORIES } from "./lifestorming.js";
import type { DesireCacheEntry } from "./entityCache.js";

export type LifestormingWorkflowDeps = {
  ensurePage: () => Page;
  pageOrThrow: () => Page;
  context: () => BrowserContext | undefined;
  clickByText: (root: SearchRoot, texts: string[], scope?: Locator) => Promise<void>;
  tryClickByText: (root: SearchRoot, texts: string[], scope?: Locator) => Promise<boolean>;
  resolveDesireInput: () => Promise<Locator>;
  resolveRowByText: (text: string, required?: boolean) => Promise<Locator | null>;
  waitForPageTextNotContaining: (needle: string, timeoutMs?: number, page?: Page) => Promise<void>;
  waitForDesiresCategory: (category: string, timeoutMs?: number, page?: Page) => Promise<void>;
  cacheDesire: (entry: { desireId: string; title?: string; category?: string }) => void;
  findDesireIdByTitle: (title: string) => string | undefined;
  entityDesires: () => Record<string, DesireCacheEntry>;
};

export function createLifestormingWorkflow(deps: LifestormingWorkflowDeps) {
  return {
    async brainstormDesiresForEachCategory(itemsByCategory: Record<string, unknown>) {
      const page = deps.ensurePage();
      await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming/desires-selection/category`, {
        waitUntil: "domcontentloaded"
      });
      let added = 0;
      const categories = Object.keys(itemsByCategory);
      for (const category of categories) {
        await deps.clickByText(page, [category.toUpperCase(), titleCase(category)]);
        const rawItems = itemsByCategory[category];
        const items = Array.isArray(rawItems) ? rawItems.map((v) => String(v)).filter((v) => v.trim().length > 0) : [];
        for (const item of items) {
          const field = await deps.resolveDesireInput();
          await field.fill(item);
          const clicked = await deps.tryClickByText(page, ["Add", "ADD"]);
          if (!clicked) await field.press("Enter");
          added += 1;
        }
      }
      return { categoriesUpdated: categories, itemsAdded: added };
    },

    async feelOutDesires(rawDesires: unknown[]) {
      const page = deps.ensurePage();
      const desires = rawDesires.map((v) => String(v)).filter((v) => v.trim().length > 0);
      const processed: string[] = [];
      for (const desire of desires) {
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });
        await this.openDesireForViewing(desire);
        const notes = page.locator("textarea").filter({ hasNotText: "Type your message" }).first();
        if ((await notes.count()) > 0) {
          await notes.fill(`Resonance check for ${desire}: feels actionable and meaningful.`);
        }
        await deps.tryClickByText(page, ["SAVE", "Save"]);
        processed.push(desire);
      }
      return { processed };
    },

    async readLifestormingOverview() {
      const page = deps.pageOrThrow();
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      await page.goto(`${base}/lifestorming`, { waitUntil: "domcontentloaded" });
      await deps.waitForPageTextNotContaining("Loading Lifestorming Page...", 2500);
      const result = extractLifestormingOverview(await page.locator("body").innerText().catch(() => ""));
      for (const section of result.desiresBySection) {
        for (const title of section.items) {
          const existingId = deps.findDesireIdByTitle(title);
          if (existingId) deps.cacheDesire({ desireId: existingId, title });
        }
      }
      return { url: page.url(), ...result };
    },

    async listLifestormingDesires() {
      const overview = await this.readLifestormingOverview();
      const bySection = new Map(overview.desiresBySection.map((section) => [section.section, section.items]));
      return {
        url: overview.url,
        buckets: [
          { category: "feel_it_out", items: bySection.get("feel_it_out") ?? [] },
          { category: "start_a_goal", items: bySection.get("start_a_goal") ?? [] }
        ],
        snippet: overview.snippet
      };
    },

    async readLifestormingCategory(category?: string) {
      const page = deps.pageOrThrow();
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      const targetUrl = `${base}/lifestorming/desires-selection/${(category ? category : "category").toLowerCase()}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await deps.waitForPageTextNotContaining("Loading Desires...", 2500);
      if (category) await deps.waitForDesiresCategory(category, 2500);
      const text = await page.locator("body").innerText().catch(() => "");
      const result = extractLifestormingCategory(text, new URL(page.url()).pathname);
      const anchors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/lifestorming/sensation-practice/"]')).map((el) => {
          const href = (el as HTMLAnchorElement).href || "";
          const match = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i);
          return { text: (el.textContent || "").trim(), desireId: match?.[1] };
        })
      );
      const normalizedCategory = result.category ? titleCase(result.category) : undefined;
      for (const item of result.items) {
        const linked = anchors.find((anchor) => anchor.text === item);
        if (linked?.desireId) deps.cacheDesire({ desireId: linked.desireId, title: item, category: normalizedCategory });
      }
      return { url: page.url(), category: result.category, intro: result.intro, items: result.items, snippet: result.snippet };
    },

    async readLifestormingFull() {
      const overview = await this.readLifestormingOverview();
      const bySection = new Map(overview.desiresBySection.map((section) => [section.section, section.items]));
      const categories = await Promise.all(LIFESTORMING_CATEGORIES.map((category) => this.readLifestormingCategoryInTemporaryPage(category)));
      return {
        overview,
        buckets: [
          { category: "feel_it_out", items: bySection.get("feel_it_out") ?? [] },
          { category: "start_a_goal", items: bySection.get("start_a_goal") ?? [] }
        ],
        categories,
        cachedDesires: Object.values(deps.entityDesires()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      };
    },

    async readSensationPractice(desireId?: string, desireTitle?: string) {
      const page = deps.pageOrThrow();
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      if (!desireId && desireTitle) desireId = deps.findDesireIdByTitle(desireTitle);
      if (desireId) {
        await page.goto(`${base}/lifestorming/sensation-practice/${encodeURIComponent(desireId)}`, { waitUntil: "domcontentloaded" });
      } else if (desireTitle) {
        await page.goto(`${base}/lifestorming`, { waitUntil: "domcontentloaded" });
        await this.openDesireForViewing(desireTitle);
        desireId = extractRouteParams(page.url()).desireId;
      } else {
        throw new Error("read_sensation_practice requires desireId or desireTitle");
      }
      await deps.waitForPageTextNotContaining("Loading...", 2500);
      const result = extractSensationPractice(await page.locator("body").innerText().catch(() => ""));
      const resolvedDesireId = desireId ?? extractRouteParams(page.url()).desireId;
      if (resolvedDesireId && result.title && !/Desire not found\.?/i.test(result.title)) {
        deps.cacheDesire({ desireId: resolvedDesireId, title: desireTitle ?? result.title, category: result.category });
      }
      return { desireId: resolvedDesireId, desireTitle: desireTitle ?? (result.title || undefined), category: result.category || undefined, url: page.url(), prompts: result.prompts, actions: result.actions, snippet: result.snippet };
    },

    async openDesireForViewing(desire: string): Promise<void> {
      const page = deps.pageOrThrow();
      const row = await deps.resolveRowByText(desire);
      if (!row) throw new Error(`could not locate desire row: ${desire}`);
      const viewed = (await deps.tryClickByText(page, ["VIEW", "GO", "Open"], row)) || (await deps.tryClickByText(page, [desire]));
      if (!viewed) throw new Error(`could not open desire for feel-out: ${desire}`);
    },

    async tryPromoteDesireToGoal(desireTitle: string): Promise<boolean> {
      const page = deps.pageOrThrow();
      await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });
      const row = await deps.resolveRowByText(desireTitle, false);
      if (!row) return false;
      return deps.tryClickByText(page, ["ADD TO GOALS", "Add to goals"], row);
    },

    async withTemporaryPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
      const context = deps.context();
      if (!context) {
        throw new StateError("playwright context not initialized", { action: "call init before using temporary pages" });
      }
      const page = await context.newPage();
      try {
        return await fn(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    },

    async readLifestormingCategoryInTemporaryPage(category: string): Promise<{ category?: string; intro?: string; items: string[] }> {
      return this.withTemporaryPage(async (page) => {
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        const targetUrl = `${base}/lifestorming/desires-selection/${category.toLowerCase()}`;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await deps.waitForPageTextNotContaining("Loading Desires...", 2500, page);
        await deps.waitForDesiresCategory(category, 2500, page);
        const text = await page.locator("body").innerText().catch(() => "");
        const result = extractLifestormingCategory(text, new URL(page.url()).pathname);
        const anchors = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href*="/lifestorming/sensation-practice/"]')).map((el) => {
            const href = (el as HTMLAnchorElement).href || "";
            const match = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i);
            return { text: (el.textContent || "").trim(), desireId: match?.[1] };
          })
        );
        const normalizedCategory = result.category ? titleCase(result.category) : undefined;
        for (const item of result.items) {
          const linked = anchors.find((anchor) => anchor.text === item);
          if (linked?.desireId) deps.cacheDesire({ desireId: linked.desireId, title: item, category: normalizedCategory });
        }
        return { category: result.category, intro: result.intro, items: result.items };
      });
    },

    async readCachedDesires() {
      return { desires: Object.values(deps.entityDesires()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)) };
    }
  };
}
