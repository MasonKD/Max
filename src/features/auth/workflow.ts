import type { Locator, Page } from "playwright";
import type { AuthState, SessionContext, StateSnapshot } from "../../core/types.js";
import { config } from "../../core/config.js";
import { selectors, cssSelectors } from "../../platform/selectors.js";
import { AuthError } from "../../core/recovery.js";
import { matchKnownRoute, extractRouteParams, type SearchRoot } from "../../platform/navigation.js";
import { readRouteSnapshotDiagnostic, readPageSectionsDiagnostic, discoverLinksDiagnostic } from "../../platform/diagnostics.js";
import { knownRoutes, type KnownRouteId } from "../../platform/catalog.js";
import { splitVisibleLines } from "../../platform/extractors.js";
import { extractAssessmentQuestionState, extractLevelCheck, extractUnderstandOverview } from "../../platform/extractors.js";

export type AuthWorkflowDeps = {
  ensurePage: () => Page;
  pageOrThrow: () => Page;
  persistAuthState: () => Promise<void>;
  isGoalsWorkspaceVisible: () => Promise<boolean>;
  ensureGoalsWorkspaceVisible: () => Promise<void>;
  resolveFirstVisible: (page: Page, selectors: string[]) => Promise<Locator>;
  tryClickByCss: (root: SearchRoot, selectors: string[], scope?: Locator) => Promise<boolean>;
  tryClickByText: (root: SearchRoot, texts: string[], scope?: Locator) => Promise<boolean>;
  resolveChatInput: () => Promise<Locator>;
  storageKeyFor: (session: SessionContext) => string;
  readGoalCount: (label: "Active" | "Complete" | "Archived" | "All") => Promise<number | null>;
  sessionGate: { isReady: () => boolean; markReady: () => void };
};

export function createAuthWorkflow(deps: AuthWorkflowDeps) {
  const allowedHosts = new Set([
    "selfmax.ai",
    "www.selfmax.ai",
    new URL(config.SELFMAX_BASE_URL).hostname
  ]);

  function assertAllowedSelfMaxUrl(rawUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`invalid explicitUrl: ${rawUrl}`);
    }

    if (!allowedHosts.has(parsed.hostname)) {
      throw new Error(`explicitUrl host not allowed: ${parsed.hostname}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`explicitUrl protocol not allowed: ${parsed.protocol}`);
    }

    return parsed.toString();
  }

  return {
    async login(): Promise<{ loggedIn: boolean; url: string }> {
      const page = deps.ensurePage();
      const authUrl = `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/auth?mode=sign-in&v=b`;
      const goalsUrl = `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`;
      let lastError: Error | null = null;

      await page.goto(goalsUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      if (await deps.isGoalsWorkspaceVisible()) {
        deps.sessionGate.markReady();
        await deps.persistAuthState();
        return { loggedIn: true, url: page.url() };
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await page.goto(authUrl, { waitUntil: "domcontentloaded" });

          const emailInput = await deps.resolveFirstVisible(page, [
            config.LOGIN_EMAIL_SELECTOR,
            ...cssSelectors(selectors.auth.emailInput)
          ]);
          await emailInput.fill(config.SELFMAX_EMAIL);

          const passwordInput = await deps.resolveFirstVisible(page, [
            config.LOGIN_PASSWORD_SELECTOR,
            ...cssSelectors(selectors.auth.passwordInput)
          ]);
          await passwordInput.fill(config.SELFMAX_PASSWORD);

          const exactSignIn = page.getByRole("button", { name: /^sign in$/i }).first();
          let submitted = false;
          if ((await exactSignIn.count()) > 0 && (await exactSignIn.isVisible().catch(() => false))) {
            await exactSignIn.click({ timeout: 1500, force: true }).catch(() => undefined);
            submitted = true;
          }
          if (!submitted) {
            submitted = await deps.tryClickByCss(page, [config.LOGIN_SUBMIT_SELECTOR, ...cssSelectors(selectors.auth.submitButtons)]);
          }
          if (!submitted) {
            await passwordInput.press("Enter").catch(() => undefined);
            submitted = true;
          }
          if (!submitted) {
            throw new AuthError("could not submit login form", {
              action: "inspect auth selectors",
              detail: "submit button did not match primary or fallback selectors"
            });
          }

          await Promise.race([
            page.waitForURL(/\/goals(\?|$)/, { timeout: 5000 }),
            page.waitForLoadState("domcontentloaded", { timeout: 5000 })
          ]).catch(() => undefined);

          if (/\/auth(\?|$)/.test(page.url())) {
            await passwordInput.press("Enter").catch(() => undefined);
            if (await deps.tryClickByCss(page, ['button[type="submit"]'])) {
              await Promise.race([
                page.waitForURL(/\/goals(\?|$)/, { timeout: 4000 }),
                page.waitForLoadState("domcontentloaded", { timeout: 4000 })
              ]).catch(() => undefined);
            }
          }

          let reachedGoals = false;
          for (let i = 0; i < 2; i += 1) {
            await page.goto(goalsUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
            try {
              await deps.ensureGoalsWorkspaceVisible();
              reachedGoals = true;
              break;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              await page.waitForTimeout(500);
            }
          }

          if (reachedGoals) {
            deps.sessionGate.markReady();
            await deps.persistAuthState();
            return { loggedIn: true, url: page.url() };
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        await page.waitForTimeout(500);
      }

      throw lastError ?? new AuthError("login failed after retries", {
        action: "re-authenticate in a long-lived session",
        detail: "storage state did not restore a valid goals workspace"
      });
    },

    async getState(session: SessionContext): Promise<StateSnapshot> {
      const page = deps.ensurePage();
      const key = deps.storageKeyFor(session);
      return page.evaluate((storageKey) => {
        const raw = window.localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : {};
      }, key);
    },

    async talkToGuide(message: string): Promise<{ sent: boolean }> {
      await this.ensureOnGoals();
      return this.sendCoachMessage(message);
    },

    async talkToGoalChat(message: string, goalTitle: string | undefined, openGoalContext: (goalTitle: string) => Promise<void>): Promise<{ sent: boolean; goalTitle?: string }> {
      if (goalTitle) {
        await openGoalContext(goalTitle);
      } else {
        await this.ensureOnGoals();
      }
      await this.sendCoachMessage(message);
      return { sent: true, goalTitle };
    },

    async sendCoachMessage(message: string): Promise<{ sent: boolean }> {
      if (!message.trim()) {
        throw new Error("message is required");
      }
      const input = await deps.resolveChatInput();
      await input.fill(message);
      let sent = await deps.tryClickByText(deps.pageOrThrow(), ["Send", "GO", "submit"], input.locator("xpath=ancestor::*[self::form or self::div][1]"));
      if (!sent) {
        await input.press("Enter").catch(() => undefined);
        sent = true;
      }
      if (!sent) {
        await input.press("Meta+Enter").catch(() => undefined);
        sent = true;
      }
      return { sent: true };
    },

    async readCoachMessages(): Promise<string[]> {
      const page = deps.ensurePage();
      const byConfiguredSelector = page.locator(config.COACH_MESSAGE_SELECTOR);
      if ((await byConfiguredSelector.count()) > 0) {
        const configuredMessages = await byConfiguredSelector
          .allTextContents()
          .then((messages) => messages.map((m) => m.trim()).filter((m) => m.length > 0));
        if (configuredMessages.length > 0) return configuredMessages;
      }

      const generic = page.locator('[class*="message"], [data-role*="message"], [data-testid*="message"]');
      if ((await generic.count()) > 0) {
        const messages = await generic.allTextContents();
        const normalized = messages.map((m) => m.trim()).filter((m) => m.length > 0);
        if (normalized.length > 0) return normalized;
      }

      const guideHeading = page.getByText(/^SELF-MAX GUIDE$/i).first();
      if ((await guideHeading.count()) > 0) {
        const guideComposer = page.locator('textarea[placeholder="Type your message..."], [contenteditable="true"]').first();
        const guidePanelCandidates: Locator[] = [];
        for (let depth = 1; depth <= 6; depth += 1) {
          guidePanelCandidates.push(guideHeading.locator(`xpath=ancestor::*[self::section or self::article or self::div][${depth}]`));
        }
        for (const panel of guidePanelCandidates) {
          if ((await panel.count()) === 0) continue;
          const text = ((await panel.innerText().catch(() => "")) || "").trim();
          if (!text || !/SELF-MAX GUIDE|Type your message/i.test(text)) continue;
          if ((await guideComposer.count()) > 0) {
            const containsComposer = await panel.locator('textarea[placeholder="Type your message..."], [contenteditable="true"]').count().catch(() => 0);
            if (!containsComposer) continue;
          }
          const structured: string[] = [];
          for (const selector of cssSelectors(selectors.coach.assistantMessages)) {
            const bubbles = panel.locator(selector);
            if ((await bubbles.count()) === 0) continue;
            const texts = await bubbles.allTextContents().catch(() => []);
            for (const entry of texts.map((value) => value.trim()).filter(Boolean)) {
              structured.push(entry);
            }
            if (structured.length > 0) return structured;
          }
          const lines = splitVisibleLines(text).filter(
            (line) =>
              line.length > 2 &&
              !/SELF-MAX GUIDE|Type your message|Send|⌘ \+ Enter to send/i.test(line)
          );
          if (lines.length > 0) return lines;
        }
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const lines = splitVisibleLines(bodyText);
      const idx = lines.findIndex((line) => /Type your message/i.test(line));
      if (idx > 0) {
        const slice = lines
          .slice(Math.max(0, idx - 24), idx)
          .filter(
            (line) =>
              line.length > 2 &&
              !/SELF-IMPROVE|GET TO WORK ON A GOAL|SELF-AWARENESS|LEARN ABOUT YOURSELF AND GET BETTER GUIDANCE|COMMUNITY|JOIN OTHER SELF-MAXERS|\(AND HM\) ON DISCORD|Help|More|WHAT DO YOU DESIRE TODAY\?|SELF-MAX GUIDE|GOAL CATEGORIES|YOUR GOALS|SHOW GOALS:|NEW GOAL|LIFESTORMING|Health|Work|Love|Family|Social|Fun|Dreams|Meaning|Active|Complete|Archived|All|Send|⌘ \+ Enter to send/i.test(
                line
              )
          );
        if (slice.length > 0) return slice;
      }

      return [];
    },

    async readAuthState(): Promise<AuthState> {
      const archivedCount = await deps.readGoalCount("Archived");
      const activeCount = await deps.readGoalCount("Active");
      const completeCount = await deps.readGoalCount("Complete");
      const allCount = await deps.readGoalCount("All");
      return {
        valid: await deps.isGoalsWorkspaceVisible(),
        archivedCount,
        activeCount,
        completeCount,
        allCount
      };
    },

    async readCurrentRoute(): Promise<{ url: string; routeId?: KnownRouteId; params: Record<string, string> }> {
      const page = deps.pageOrThrow();
      const url = page.url();
      return { url, routeId: matchKnownRoute(url), params: extractRouteParams(url) };
    },

    async readKnownRoutes(): Promise<typeof knownRoutes> {
      return knownRoutes;
    },

    async readRouteSnapshot(route?: string, explicitUrl?: string): Promise<{
      url: string;
      auth?: AuthState;
      headingCandidates: string[];
      buttonTexts: string[];
      inputPlaceholders: string[];
      snippet: string;
    }> {
      const page = deps.pageOrThrow();
      if (explicitUrl) {
        await page.goto(assertAllowedSelfMaxUrl(explicitUrl), { waitUntil: "domcontentloaded" });
      } else if (route && route in knownRoutes) {
        await this.navigate(route as KnownRouteId);
      } else if (route) {
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        const path = route.startsWith("/") ? route : `/${route}`;
        await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
      }
      const onGoals = /\/goals(\?|$)/.test(page.url());
      return readRouteSnapshotDiagnostic(page, onGoals ? await this.readAuthState() : undefined);
    },

    async readPageSections(route: string | undefined, explicitUrl: string | undefined, navigateForRead: (route?: string, explicitUrl?: string) => Promise<void>) {
      const page = deps.pageOrThrow();
      await navigateForRead(route, explicitUrl);
      return readPageSectionsDiagnostic(page);
    },

    async discoverLinks(route: string | undefined, explicitUrl: string | undefined, navigateForRead: (route?: string, explicitUrl?: string) => Promise<void>) {
      const page = deps.pageOrThrow();
      await navigateForRead(route, explicitUrl);
      return discoverLinksDiagnostic(page);
    },

    async readUnderstandOverview() {
      const page = deps.pageOrThrow();
      await this.navigate("understand");
      const text = await page.locator("body").innerText().catch(() => "");
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((el) => ({
            text: ((el.textContent || "").replace(/\s+/g, " ").trim()),
            href: (el as HTMLAnchorElement).href || ""
          }))
          .filter((item) => item.text)
      );
      return { url: page.url(), routeId: "understand", ...extractUnderstandOverview(text, links) };
    },

    async readLevelCheck() {
      const page = deps.pageOrThrow();
      await page.goto(knownRoutes.level_check, { waitUntil: "domcontentloaded" });
      const text = await page.locator("body").innerText().catch(() => "");
      return { url: page.url(), routeId: "level_check", ...extractLevelCheck(text) };
    },

    async readLifeHistoryAssessment() {
      const page = deps.pageOrThrow();
      await page.goto(knownRoutes.assessment_life_history, { waitUntil: "domcontentloaded" });
      const text = await page.locator("body").innerText().catch(() => "");
      return { url: page.url(), routeId: "assessment_life_history", ...extractAssessmentQuestionState(text) };
    },

    async readBigFiveAssessment() {
      const page = deps.pageOrThrow();
      await page.goto(knownRoutes.assessment_big_five, { waitUntil: "domcontentloaded" });
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const text = await page.locator("body").innerText().catch(() => "");
        if (!/Loading Test Information/i.test(text)) {
          return { url: page.url(), routeId: "assessment_big_five", ...extractAssessmentQuestionState(text) };
        }
        await page.waitForTimeout(250);
      }
      const text = await page.locator("body").innerText().catch(() => "");
      return { url: page.url(), routeId: "assessment_big_five", ...extractAssessmentQuestionState(text) };
    },

    async navigate(route: KnownRouteId): Promise<{ route: KnownRouteId; url: string }> {
      const page = deps.ensurePage();
      const url = knownRoutes[route];
      if (!url) {
        throw new Error(`unknown route: ${route}`);
      }
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return { route, url: page.url() };
    },

    async navigateForRead(route?: string, explicitUrl?: string): Promise<void> {
      const page = deps.pageOrThrow();
      if (explicitUrl) {
        await page.goto(assertAllowedSelfMaxUrl(explicitUrl), { waitUntil: "domcontentloaded" });
        return;
      }
      if (route && route in knownRoutes) {
        await this.navigate(route as KnownRouteId);
        return;
      }
      if (route) {
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        const path = route.startsWith("/") ? route : `/${route}`;
        await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
      }
    },

    async ensureOnGoals(): Promise<void> {
      const page = deps.pageOrThrow();
      if (page.url().includes("/goals") && (deps.sessionGate.isReady() || (await deps.isGoalsWorkspaceVisible()))) {
        if (!deps.sessionGate.isReady()) {
          deps.sessionGate.markReady();
        }
        return;
      }
      await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" });
      await deps.ensureGoalsWorkspaceVisible();
      if (!deps.sessionGate.isReady()) {
        deps.sessionGate.markReady();
      }
    }
  };
}
