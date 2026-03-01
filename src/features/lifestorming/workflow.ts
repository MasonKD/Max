import type { BrowserContext, Locator, Page } from "playwright";
import type { SearchRoot } from "../../platform/navigation.js";
import { config } from "../../core/config.js";
import { extractLifestormingOverview, extractSensationPractice } from "../../platform/extractors.js";
import { extractRouteParams } from "../../platform/navigation.js";
import { StateError } from "../../core/recovery.js";
import type { DesireCacheEntry } from "../../client/entityCache.js";

type LifestormingCategory = "Health" | "Work" | "Love" | "Family" | "Social" | "Fun" | "Dreams" | "Meaning";
type CategoryItems = Partial<Record<LifestormingCategory, string[]>>;
type DesireNotes = Array<{ title: string; notes: string }>;

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
  function categoryPathSegment(category: string): string {
    return category.trim().toUpperCase();
  }

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

  function syntheticDesireId(title: string): string {
    return `title:${normalizeKey(title)}`;
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

  function findCachedDesireCategory(title: string): string | undefined {
    const normalized = normalizeKey(title);
    if (!normalized) return undefined;
    for (const entry of Object.values(deps.entityDesires())) {
      if (normalizeKey(entry.title) === normalized && entry.category?.trim()) {
        return entry.category;
      }
    }
    return undefined;
  }

  async function findVisibleDesireLinksOnRoot(page: Page): Promise<Array<{ title: string; desireId: string }>> {
    return page.evaluate(() => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
      const isNoise = (value: string) =>
        /^(GO|VIEW|OPEN|ADD TO GOALS|SAVE|EXIT|DELETE DESIRE)$/i.test(value) ||
        /^STEP\s+\d+:/i.test(value) ||
        /^(LIFESTORMING|BRAINSTORM|YOUR LIFE)$/i.test(value);
      const rows = Array.from(document.querySelectorAll("a, button, [role='button']"));
      const matches: Array<{ title: string; desireId: string }> = [];
      for (const node of rows) {
        const actionText = normalize(node.textContent || "");
        if (!/^(GO|VIEW|OPEN)$/i.test(actionText)) continue;
        const container = node.closest("li, article, section, div");
        if (!container) continue;
        const hrefNode = container.querySelector('a[href*="/lifestorming/sensation-practice/"]') || (node instanceof HTMLAnchorElement ? node : null);
        const href = hrefNode instanceof HTMLAnchorElement ? hrefNode.href || "" : "";
        const desireId = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i)?.[1];
        if (!desireId) continue;
        const title = Array.from(container.querySelectorAll("p, label, span, div"))
          .map((element) => normalize(element.textContent || ""))
          .find((text) => text.length > 2 && !isNoise(text));
        if (!title) continue;
        matches.push({ title, desireId });
      }
      const deduped = new Map<string, { title: string; desireId: string }>();
      for (const match of matches) {
        if (!deduped.has(match.desireId)) deduped.set(match.desireId, match);
      }
      return [...deduped.values()];
    }).catch(() => []);
  }

  function tryCacheDesire(entry: { desireId: string; title?: string; category?: string }): void {
    try {
      deps.cacheDesire(entry);
    } catch {
      // Read paths should stay available even if the live page exposes duplicate or stale desire rows.
    }
  }

  return {
    async brainstormDesiresForEachCategory(itemsByCategory: CategoryItems) {
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
      const categories = Object.keys(itemsByCategory) as LifestormingCategory[];
      for (const category of categories) {
        await page.goto(`${base}/lifestorming/desires-selection/${categoryPathSegment(category)}`, {
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
          tryCacheDesire({ desireId: syntheticDesireId(item), title: item, category });
          added += 1;
        }
      }
      await this.readLifestormingOverview().catch(() => undefined);
      return { categoriesUpdated: categories, itemsAdded: added };
    },

    async feelOutDesires(rawDesires: DesireNotes) {
      const page = deps.ensurePage();
      const desires = rawDesires.filter((entry) => entry.title.trim().length > 0);
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
        if (desireId) tryCacheDesire({ desireId, title: desire.title });
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
      const rootLinks = await findVisibleDesireLinksOnRoot(page);
      for (const link of rootLinks) tryCacheDesire(link);
      for (const section of result.desiresBySection) {
        for (const title of section.items) {
          let existingId = deps.findDesireIdByTitle(title);
          if (!existingId) {
            const href = await findDesireHrefOnRoot(page, title);
            existingId = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i)?.[1];
          }
          if (existingId) tryCacheDesire({ desireId: existingId, title });
        }
      }
      return { url: page.url(), ...result };
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
        tryCacheDesire({ desireId: resolvedDesireId, title: desireTitle ?? result.title, category: result.category });
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
        if (desireIdMatch?.[1]) tryCacheDesire({ desireId: desireIdMatch[1], title: desire });
        await page.goto(normalizedHref, { waitUntil: "domcontentloaded" });
        return;
      }

      const cachedCategory = findCachedDesireCategory(desire);
      if (cachedCategory) {
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        await page.goto(`${base}/lifestorming/desires-selection/${categoryPathSegment(cachedCategory)}`, { waitUntil: "domcontentloaded" });
        await deps.waitForPageTextNotContaining("Loading Desires...", 2500);
        const rowInCategory = await deps.resolveRowByText(desire, false);
        if (rowInCategory) {
          const viewedFromCategory =
            (await deps.tryClickByText(page, ["VIEW", "GO", "Open"], rowInCategory)) ||
            (await deps.tryClickByText(page, [desire]));
          if (viewedFromCategory) return;
        }
      }

      let viewed = false;
      const row = await deps.resolveRowByText(desire, false);
      if (row) viewed = (await deps.tryClickByText(page, ["VIEW", "GO", "Open"], row)) || (await deps.tryClickByText(page, [desire]));
      if (!viewed) throw new Error(`could not open desire for feel-out: ${desire}`);
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

    async readCachedDesires() {
      if (Object.keys(deps.entityDesires()).length === 0) {
        const overview = await this.readLifestormingOverview().catch(() => null);
        const titles = overview
          ? [...new Set(overview.desiresBySection.flatMap((section) => section.items).map((item) => item.trim()).filter((item) => item.length > 0))]
          : [];
        for (const title of titles) {
          const existing = Object.values(deps.entityDesires()).find((entry) => entry.title?.trim().toLowerCase() === title.trim().toLowerCase());
          if (existing?.desireId && existing.category?.trim()) continue;
          await this.readSensationPractice(undefined, title).catch(() => undefined);
        }
      }
      return { desires: Object.values(deps.entityDesires()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)) };
    }
  };
}
