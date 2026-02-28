import type { BrowserContext, Locator, Page } from "playwright";
import type { SearchRoot } from "../../platform/navigation.js";
import { config } from "../../core/config.js";
import { extractLifestormingCategory, extractLifestormingOverview, extractSensationPractice } from "../../platform/extractors.js";
import { extractRouteParams, titleCase } from "../../platform/navigation.js";
import { StateError } from "../../core/recovery.js";
import { LIFESTORMING_CATEGORIES } from "./constants.js";
import type { DesireCacheEntry } from "../../client/entityCache.js";

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
  function normalizeKey(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
  }

  function assertUniqueNormalized(values: string[], label: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = normalizeKey(value);
      if (!normalized) continue;
      if (seen.has(normalized)) throw new Error(`${label} must be unique: "${value}"`);
      seen.add(normalized);
    }
  }

  async function findDesireHrefOnRoot(page: Page, desire: string): Promise<string> {
    return page.evaluate((title) => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
      const anchors = Array.from(document.querySelectorAll('a[href*="/lifestorming/sensation-practice/"]'));
      for (const anchor of anchors) {
        const row = anchor.closest("li");
        if (!row) continue;
        const labels = Array.from(row.querySelectorAll("p, label"))
          .map((node) => normalize(node.textContent || ""))
          .filter(Boolean);
        if (labels.some((label) => label === title)) {
          return (anchor as HTMLAnchorElement).href || "";
        }
      }
      return "";
    }, desire).catch(() => "");
  }

  return {
    async brainstormDesiresForEachCategory(itemsByCategory: Record<string, unknown>) {
      const page = deps.ensurePage();
      const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
      const requestedItems = Object.values(itemsByCategory)
        .flatMap((rawItems) => Array.isArray(rawItems) ? rawItems.map((value) => String(value).trim()).filter((value) => value.length > 0) : []);
      assertUniqueNormalized(requestedItems, "desire titles");
      const existing = await this.readLifestormingOverview();
      const existingTitles = existing.desiresBySection.flatMap((section) => section.items).map((item) => item.trim()).filter((item) => item.length > 0);
      const existingKeys = new Set(existingTitles.map((title) => normalizeKey(title)).filter(Boolean));
      for (const item of requestedItems) {
        if (existingKeys.has(normalizeKey(item))) {
          throw new Error(`desire title must be unique: "${item}" already exists`);
        }
      }
      let added = 0;
      const categories = Object.keys(itemsByCategory);
      for (const category of categories) {
        await page.goto(`${base}/lifestorming/desires-selection/${category.toLowerCase()}`, {
          waitUntil: "domcontentloaded"
        });
        await deps.waitForPageTextNotContaining("Loading Desires...", 2500);
        await deps.waitForDesiresCategory(category, 2500);
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
      const desires = rawDesires
        .map((entry) => {
          if (typeof entry === "string") return { title: entry, notes: `Resonance check for ${entry}: feels actionable and meaningful.` };
          if (entry && typeof entry === "object") {
            const obj = entry as Record<string, unknown>;
            const title = String(obj.title ?? "");
            const notes = String(obj.notes ?? `Resonance check for ${title}: feels actionable and meaningful.`);
            return { title, notes };
          }
          return { title: "", notes: "" };
        })
        .filter((entry) => entry.title.trim().length > 0);
      const processed: Array<{ title: string; notes: string }> = [];
      for (const desire of desires) {
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });
        await deps.waitForPageTextNotContaining("Loading Lifestorming Page...", 2500);
        await page.waitForTimeout(500);
        await this.openDesireForViewing(desire.title);
        const navDeadline = Date.now() + 3000;
        while (Date.now() < navDeadline) {
          if (/\/lifestorming\/sensation-practice\//i.test(page.url())) break;
          await page.waitForTimeout(200);
        }
        if (!/\/lifestorming\/sensation-practice\//i.test(page.url())) {
          throw new Error(`did not reach sensation-practice route for ${desire.title}`);
        }
        const desireId = extractRouteParams(page.url()).desireId;
        if (desireId) deps.cacheDesire({ desireId, title: desire.title });
        const notes = page.locator("textarea").filter({ hasNotText: "Type your message" }).first();
        if ((await notes.count()) > 0) {
          await notes.fill(desire.notes);
        }
        await deps.tryClickByText(page, ["SAVE", "Save"]);
        await page.waitForTimeout(1500);
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
      const rootAnchors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/lifestorming/sensation-practice/"]')).map((el) => {
          const href = (el as HTMLAnchorElement).href || "";
          const match = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i);
          const row = el.closest("li");
          const titleNode = row
            ? Array.from(row.querySelectorAll("p, label, span, div"))
                .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
                .find((text) => text.length > 2 && !/^(GO|VIEW|OPEN|ADD TO GOALS)$/i.test(text))
            : undefined;
          const title = titleNode || undefined;
          return {
            href,
            desireId: match?.[1],
            title
          };
        })
      );
      for (const anchor of rootAnchors) {
        if (anchor.desireId && anchor.title) {
          deps.cacheDesire({ desireId: anchor.desireId, title: anchor.title });
        }
      }
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
        await deps.waitForPageTextNotContaining("Loading Lifestorming Page...", 2500);
        await page.waitForTimeout(500);
        await this.openDesireForViewing(desireTitle);
        desireId = extractRouteParams(page.url()).desireId;
      } else {
        throw new Error("read_sensation_practice requires desireId or desireTitle");
      }
      const navDeadline = Date.now() + 3000;
      while (Date.now() < navDeadline) {
        if (/\/lifestorming\/sensation-practice\//i.test(page.url())) break;
        await page.waitForTimeout(200);
      }
      if (!/\/lifestorming\/sensation-practice\//i.test(page.url())) {
        throw new Error(`did not reach sensation-practice route for ${desireTitle ?? desireId ?? "desire"}`);
      }
      await deps.waitForPageTextNotContaining("Loading...", 2500);
      const result = extractSensationPractice(await page.locator("body").innerText().catch(() => ""));
      let noteText = await page.locator("textarea").first().inputValue().catch(() => "");
      const resolvedDesireId = desireId ?? extractRouteParams(page.url()).desireId;
      if (resolvedDesireId && result.title && !/Desire not found\.?/i.test(result.title)) {
        deps.cacheDesire({ desireId: resolvedDesireId, title: desireTitle ?? result.title, category: result.category });
      }
      return { desireId: resolvedDesireId, desireTitle: desireTitle ?? (result.title || undefined), category: result.category || undefined, url: page.url(), prompts: result.prompts, actions: result.actions, noteText, snippet: result.snippet };
    },

    async openDesireForViewing(desire: string): Promise<void> {
      const page = deps.pageOrThrow();
      await page.waitForTimeout(300);
      const directHref = await findDesireHrefOnRoot(page, desire);
      if (directHref) {
        const normalizedHref = new URL(directHref, page.url()).toString();
        const desireIdMatch = normalizedHref.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i);
        if (desireIdMatch?.[1]) deps.cacheDesire({ desireId: desireIdMatch[1], title: desire });
        await page.goto(normalizedHref, { waitUntil: "domcontentloaded" });
        return;
      }

      let viewed = false;
      const row = await deps.resolveRowByText(desire, false);
      if (row) viewed = (await deps.tryClickByText(page, ["VIEW", "GO", "Open"], row)) || (await deps.tryClickByText(page, [desire]));
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
