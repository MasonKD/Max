import type { Page } from "playwright";
import { config } from "./config.js";
import { logger } from "./logger.js";

const pageOwners = new WeakMap<Page, string>();

export function setPageOwner(page: Page, owner: string): void {
  pageOwners.set(page, owner);
}

export function getPageOwner(page: Page): string {
  return pageOwners.get(page) ?? "unknown";
}

type LogMeta = Record<string, unknown>;

export async function timeAction<T>(
  kind: "public_api" | "primitive" | "navigation",
  action: string,
  meta: LogMeta,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  logger.info({ kind, action, phase: "start", ...meta }, `${kind}:${action}:start`);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    if (config.LOG_TIMINGS) {
      logger.info({ kind, action, phase: "end", durationMs, ...meta }, `${kind}:${action}:end`);
    }
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error({ kind, action, phase: "error", durationMs, ...meta, err: error }, `${kind}:${action}:error`);
    throw error;
  }
}

export async function navigatePage(
  page: Page,
  url: string,
  options: Parameters<Page["goto"]>[1] | undefined,
  meta: LogMeta = {}
): Promise<void> {
  const fromUrl = page.url();
  const pageOwner = getPageOwner(page);
  await timeAction("navigation", "goto", { pageOwner, fromUrl, toUrl: url, ...meta }, async () => {
    await page.goto(url, options);
  });
}
