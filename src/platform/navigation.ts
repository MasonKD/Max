import type { Locator, Page } from "playwright";
import { knownRoutes, type KnownRouteId } from "./catalog.js";
import { SelectorError, TimeoutError } from "../core/recovery.js";

export type SearchRoot = Page | Locator;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeDateInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!mdy) {
    return null;
  }

  return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
}

export function goalIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("goalId") ?? undefined;
  } catch {
    return undefined;
  }
}

export function extractRouteParams(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const params: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams.entries()) {
      params[key] = value;
    }

    const desireMatch = parsed.pathname.match(/\/lifestorming\/sensation-practice\/([^/?#]+)/i);
    if (desireMatch?.[1]) {
      params.desireId = desireMatch[1];
    }

    const categoryMatch = parsed.pathname.match(/\/lifestorming\/desires-selection\/([^/?#]+)/i);
    if (categoryMatch?.[1] && categoryMatch[1] !== "category") {
      params.category = categoryMatch[1];
    }

    return params;
  } catch {
    return {};
  }
}

export function matchKnownRoute(url: string): KnownRouteId | undefined {
  try {
    const parsed = new URL(url);
    const normalized = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const entries = Object.entries(knownRoutes) as Array<[KnownRouteId, string]>;
    for (const [routeId, routeUrl] of entries) {
      if (normalized === routeUrl) {
        return routeId;
      }
    }
    if (parsed.pathname === "/auth") {
      if (parsed.searchParams.get("mode") === "sign-in" && parsed.searchParams.get("v") === "b") return "signin";
      if (parsed.searchParams.get("mode") === "sign-up" && parsed.searchParams.get("v") === "b") return "signup";
      if (parsed.searchParams.get("mode") === "sign-up") return "auth_signup_alt";
      return "auth";
    }
    if (parsed.pathname === "/goals") return "goals";
    if (parsed.pathname === "/home") return "home_legacy";
    if (parsed.pathname === "/lifestorming") return "lifestorming";
    if (parsed.pathname.startsWith("/lifestorming/desires-selection")) return "lifestorming_desires_selection";
  } catch {
    return undefined;
  }
  return undefined;
}

export async function tryClickByCss(root: SearchRoot, selectors: string[], scope?: Locator): Promise<boolean> {
  const searchRoot = scope ?? root;
  for (const selector of selectors) {
    const node = searchRoot.locator(selector).first();
    if ((await node.count()) === 0) continue;
    if (!(await node.isVisible().catch(() => false))) continue;
    try {
      await node.scrollIntoViewIfNeeded().catch(() => undefined);
      await node.click({ timeout: 1500 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function tryClickByText(root: SearchRoot, texts: string[], scope?: Locator): Promise<boolean> {
  const searchRoot = scope ?? root;
  for (const text of texts) {
    const candidates = [
      searchRoot.getByRole("button", { name: new RegExp(`^${escapeRegex(text)}$`, "i") }).first(),
      searchRoot.getByRole("button", { name: new RegExp(escapeRegex(text), "i") }).first(),
      searchRoot.getByRole("link", { name: new RegExp(escapeRegex(text), "i") }).first(),
      searchRoot.getByText(text, { exact: true }).first(),
      searchRoot.getByText(new RegExp(escapeRegex(text), "i")).first()
    ];

    for (const candidate of candidates) {
      if ((await candidate.count()) === 0) continue;
      if (!(await candidate.isVisible().catch(() => false))) continue;
      try {
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ timeout: 1500 });
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

export async function clickByText(root: SearchRoot, texts: string[], scope?: Locator): Promise<void> {
  const clicked = await tryClickByText(root, texts, scope);
  if (!clicked) {
    throw new SelectorError(`could not click any of: ${texts.join(", ")}`, {
      action: "refresh selector registry",
      detail: "target text no longer matches"
    }, {
      target: texts.join(" | "),
      expected: "visible clickable text target"
    });
  }
}

export async function resolveFirstVisible(root: SearchRoot, selectors: string[]): Promise<Locator> {
  for (const selector of selectors) {
    const input = root.locator(selector).first();
    if ((await input.count()) === 0) continue;
    if (!(await input.isVisible().catch(() => false))) continue;
    return input;
  }
  throw new SelectorError(`could not locate any input for selectors: ${selectors.join(", ")}`, {
    action: "inspect selector tiers",
    detail: "promote a working fallback or add a new primary selector"
  }, {
    target: selectors.join(" | "),
    expected: "visible input matching selector"
  });
}

export async function waitForCondition(
  page: Page,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  errorMessage: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new TimeoutError(errorMessage, {
    action: "short-circuit retries or inspect loading state",
    detail: `timed out after ${timeoutMs}ms`
  }, {
    expected: errorMessage
  });
}
