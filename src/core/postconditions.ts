import type { Page } from "playwright";
import { TimeoutError } from "./recovery.js";

export async function waitForTruthy<T>(
  page: Page,
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  errorMessage: string,
  pollMs = 200
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await read();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await page.waitForTimeout(pollMs);
  }
  throw new TimeoutError(errorMessage, {
    action: "inspect expected postcondition",
    detail: `timed out after ${timeoutMs}ms`
  });
}

export async function waitForBoolean(
  page: Page,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  errorMessage: string,
  pollMs = 200
): Promise<void> {
  await waitForTruthy(page, predicate, Boolean, timeoutMs, errorMessage, pollMs);
}
