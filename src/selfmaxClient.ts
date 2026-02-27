import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "./config.js";
import { AtomicExecutor } from "./atomic.js";
import type { PrimitiveRequest, PrimitiveResponse, SessionContext } from "./types.js";
import { actionById, knownActions, knownRoutes, type KnownActionId, type KnownRouteId } from "./catalog.js";

export class SelfMaxPlaywrightClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly atomic = new AtomicExecutor();

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.HEADLESS });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  async execute(req: PrimitiveRequest, session: SessionContext): Promise<PrimitiveResponse> {
    try {
      const result = await this.atomic.run(async () => {
        switch (req.name) {
          case "login":
            return this.login();
          case "set_state":
            return this.setState(session, req.payload ?? {});
          case "get_state":
            return this.getState(session);
          case "send_coach_message":
            return this.sendCoachMessage(String(req.payload?.message ?? ""));
          case "read_coach_messages":
            return this.readCoachMessages();
          case "navigate":
            return this.navigate((req.payload?.route as KnownRouteId | undefined) ?? "goals");
          case "list_known_actions":
            return this.listKnownActions((req.payload?.route as KnownRouteId | undefined) ?? null);
          case "invoke_known_action":
            return this.invokeKnownAction(req.payload ?? {});
          default:
            return this.assertUnreachable(req.name);
        }
      });

      return {
        id: req.id,
        ok: true,
        result
      };
    } catch (error) {
      return {
        id: req.id,
        ok: false,
        error: error instanceof Error ? error.message : "unknown error"
      };
    }
  }

  private assertUnreachable(value: never): never {
    throw new Error(`unsupported primitive: ${String(value)}`);
  }

  private ensurePage(): Page {
    if (!this.page) {
      throw new Error("playwright client not initialized");
    }
    return this.page;
  }

  private async login(): Promise<{ loggedIn: boolean }> {
    const page = this.ensurePage();
    await page.goto(config.SELFMAX_BASE_URL, { waitUntil: "domcontentloaded" });
    await page.fill(config.LOGIN_EMAIL_SELECTOR, config.SELFMAX_EMAIL);
    await page.fill(config.LOGIN_PASSWORD_SELECTOR, config.SELFMAX_PASSWORD);
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click(config.LOGIN_SUBMIT_SELECTOR)
    ]);
    return { loggedIn: true };
  }

  private async setState(session: SessionContext, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const page = this.ensurePage();
    const key = this.storageKeyFor(session);

    const updated = await page.evaluate(
      ({ storageKey, incoming }) => {
        const currentRaw = window.localStorage.getItem(storageKey);
        const current = currentRaw ? JSON.parse(currentRaw) : {};
        const next = {
          ...current,
          ...incoming,
          updatedAt: new Date().toISOString()
        };
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      },
      { storageKey: key, incoming: patch }
    );

    return updated;
  }

  private async getState(session: SessionContext): Promise<Record<string, unknown>> {
    const page = this.ensurePage();
    const key = this.storageKeyFor(session);

    const state = await page.evaluate((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    }, key);

    return state;
  }

  private async sendCoachMessage(message: string): Promise<{ sent: boolean }> {
    const page = this.ensurePage();
    if (!message.trim()) {
      throw new Error("message is required");
    }

    await page.fill(config.COACH_INPUT_SELECTOR, message);
    await page.click(config.COACH_SEND_SELECTOR);

    return { sent: true };
  }

  private async readCoachMessages(): Promise<string[]> {
    const page = this.ensurePage();
    const messages = await page.$$eval(config.COACH_MESSAGE_SELECTOR, (nodes) =>
      nodes
        .map((node) => node.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
    );
    return messages;
  }

  private async navigate(route: KnownRouteId): Promise<{ route: KnownRouteId; url: string }> {
    const page = this.ensurePage();
    const url = knownRoutes[route];
    if (!url) {
      throw new Error(`unknown route: ${route}`);
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { route, url: page.url() };
  }

  private async listKnownActions(route: KnownRouteId | null): Promise<typeof knownActions> {
    if (!route) {
      return [...knownActions];
    }
    return knownActions.filter((action) => action.route === route);
  }

  private async invokeKnownAction(payload: Record<string, unknown>): Promise<{ invoked: KnownActionId }> {
    const page = this.ensurePage();
    const actionId = payload.actionId as KnownActionId | undefined;
    if (!actionId) {
      throw new Error("payload.actionId is required");
    }

    const action = actionById.get(actionId);
    if (!action) {
      throw new Error(`unknown actionId: ${actionId}`);
    }

    const message = payload.message;
    if (typeof message === "string" && action.id === "goals.send_guide_message") {
      await page.fill(config.COACH_INPUT_SELECTOR, message);
    }

    await page.click(action.selector);
    return { invoked: action.id };
  }

  private storageKeyFor(session: SessionContext): string {
    return `${config.SELFMAX_STATE_KEY}:${session.userId}:${session.sessionId}`;
  }
}
