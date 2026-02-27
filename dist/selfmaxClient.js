import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { AtomicExecutor } from "./atomic.js";
import { actionById, knownActions, knownRoutes } from "./catalog.js";
export class SelfMaxPlaywrightClient {
    browser;
    context;
    page;
    atomic = new AtomicExecutor();
    entityCache = { goalsById: {}, desiresById: {} };
    async init() {
        this.browser = await chromium.launch({ headless: config.HEADLESS });
        const contextOptions = existsSync(config.SELFMAX_STORAGE_STATE_PATH)
            ? { storageState: config.SELFMAX_STORAGE_STATE_PATH }
            : undefined;
        this.context = await this.browser.newContext(contextOptions);
        this.page = await this.context.newPage();
    }
    async close() {
        await this.context?.close();
        await this.browser?.close();
    }
    async execute(req, session) {
        try {
            const result = await this.atomic.run(async () => {
                switch (req.name) {
                    case "login":
                        return this.login();
                    case "set_state":
                        return this.setState(session, req.payload ?? {});
                    case "get_state":
                        return this.getState(session);
                    case "talk_to_guide":
                        return this.talkToGuide(String(req.payload?.message ?? ""));
                    case "talk_to_goal_chat":
                        return this.talkToGoalChat(String(req.payload?.message ?? ""), this.asOptionalString(req.payload?.goalTitle));
                    case "send_coach_message":
                        return this.sendCoachMessage(String(req.payload?.message ?? ""));
                    case "read_coach_messages":
                        return this.readCoachMessages();
                    case "brainstorm_desires_for_each_category":
                        return this.brainstormDesiresForEachCategory(req.payload?.itemsByCategory ?? {});
                    case "feel_out_desires":
                        return this.feelOutDesires(req.payload?.desires ?? []);
                    case "create_goals_from_desires":
                        return this.createGoalsFromDesires(req.payload?.desires ?? []);
                    case "create_goal":
                        return this.createGoal({
                            title: String(req.payload?.title ?? ""),
                            category: this.asOptionalString(req.payload?.category),
                            dueDate: this.asOptionalString(req.payload?.dueDate)
                        });
                    case "read_auth_state":
                        return this.readAuthState();
                    case "read_current_route":
                        return this.readCurrentRoute();
                    case "read_known_routes":
                        return this.readKnownRoutes();
                    case "read_goals_overview":
                        return this.readGoalsOverview();
                    case "read_route_snapshot":
                        return this.readRouteSnapshot(this.asOptionalString(req.payload?.route), this.asOptionalString(req.payload?.url));
                    case "read_page_sections":
                        return this.readPageSections(this.asOptionalString(req.payload?.route), this.asOptionalString(req.payload?.url));
                    case "discover_links":
                        return this.discoverLinks(this.asOptionalString(req.payload?.route), this.asOptionalString(req.payload?.url));
                    case "list_goals":
                        return this.listGoals(req.payload?.filter ?? "all");
                    case "discover_goals":
                        return this.discoverGoals(req.payload?.waitMs);
                    case "discover_goal_ids":
                        return this.discoverGoalIds(req.payload?.waitMs);
                    case "read_goal":
                        return this.readGoal(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "read_goal_metadata":
                        return this.readGoalMetadata(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "read_goal_workspace":
                        return this.readGoalWorkspace(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "read_goal_full":
                        return this.readGoalFull(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "read_cached_goals":
                        return this.readCachedGoals();
                    case "read_cached_desires":
                        return this.readCachedDesires();
                    case "read_task_panel_snapshot":
                        return this.readTaskPanelSnapshot(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "survey_active_goal_task_states":
                        return this.surveyActiveGoalTaskStates();
                    case "list_goal_tasks":
                        return this.listGoalTasks(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "read_goal_chat":
                        return this.readGoalChat(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "read_lifestorming_overview":
                        return this.readLifestormingOverview();
                    case "list_lifestorming_desires":
                        return this.listLifestormingDesires();
                    case "read_lifestorming_category":
                        return this.readLifestormingCategory(this.asOptionalString(req.payload?.category));
                    case "read_lifestorming_full":
                        return this.readLifestormingFull();
                    case "read_sensation_practice":
                        return this.readSensationPractice(this.asOptionalString(req.payload?.desireId), this.asOptionalString(req.payload?.desireTitle));
                    case "start_goal":
                        return this.startGoal(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "add_tasks":
                        return this.addTasks(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId), (req.payload?.tasks ?? []).map((v) => String(v)), Boolean(req.payload?.useSuggestions));
                    case "remove_task":
                        return this.removeTask(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId), String(req.payload?.taskText ?? ""));
                    case "complete_task":
                        return this.completeTask(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId), String(req.payload?.taskText ?? ""));
                    case "uncomplete_task":
                        return this.uncompleteTask(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId), String(req.payload?.taskText ?? ""));
                    case "complete_goal":
                        return this.completeGoal(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "archive_goal":
                        return this.archiveGoal(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "delete_goal":
                        return this.deleteGoal(this.asOptionalString(req.payload?.goalTitle), this.asOptionalString(req.payload?.goalId));
                    case "delete_goal_api":
                        return this.deleteGoalApi(this.asOptionalString(req.payload?.goalId));
                    case "navigate":
                        return this.navigate(req.payload?.route ?? "goals");
                    case "list_known_actions":
                        return this.listKnownActions(req.payload?.route ?? null);
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
        }
        catch (error) {
            return {
                id: req.id,
                ok: false,
                error: error instanceof Error ? error.message : "unknown error"
            };
        }
    }
    assertUnreachable(value) {
        throw new Error(`unsupported primitive: ${String(value)}`);
    }
    ensurePage() {
        if (!this.page) {
            throw new Error("playwright client not initialized");
        }
        return this.page;
    }
    asOptionalString(value) {
        if (typeof value !== "string") {
            return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    async login() {
        const page = this.ensurePage();
        const authUrl = `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/auth?mode=sign-in&v=b`;
        const goalsUrl = `${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`;
        let lastError = null;
        await page.goto(goalsUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        if (await this.isGoalsWorkspaceVisible()) {
            await this.persistAuthState();
            return { loggedIn: true, url: page.url() };
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await page.goto(authUrl, { waitUntil: "domcontentloaded" });
                const emailInput = await this.resolveFirstVisible(page, [
                    config.LOGIN_EMAIL_SELECTOR,
                    'input[type=\"email\"]',
                    'input[name*=\"email\" i]'
                ]);
                await emailInput.fill(config.SELFMAX_EMAIL);
                const passwordInput = await this.resolveFirstVisible(page, [
                    config.LOGIN_PASSWORD_SELECTOR,
                    'input[type=\"password\"]',
                    'input[name*=\"password\" i]'
                ]);
                await passwordInput.fill(config.SELFMAX_PASSWORD);
                const exactSignIn = page.getByRole("button", { name: /^sign in$/i }).first();
                let submitted = false;
                if ((await exactSignIn.count()) > 0 && (await exactSignIn.isVisible().catch(() => false))) {
                    await exactSignIn.click({ timeout: 1500 });
                    submitted = true;
                }
                if (!submitted) {
                    submitted = await this.tryClickByCss(page, [config.LOGIN_SUBMIT_SELECTOR, 'button[type=\"submit\"]']);
                }
                if (!submitted) {
                    throw new Error("could not submit login form");
                }
                await Promise.race([
                    page.waitForURL(/\/goals(\?|$)/, { timeout: 15000 }),
                    page.waitForLoadState("domcontentloaded", { timeout: 15000 })
                ]).catch(() => undefined);
                if (/\/auth(\?|$)/.test(page.url())) {
                    await passwordInput.press("Enter").catch(() => undefined);
                    if (await this.tryClickByCss(page, ['button[type=\"submit\"]'])) {
                        await Promise.race([
                            page.waitForURL(/\/goals(\?|$)/, { timeout: 10000 }),
                            page.waitForLoadState("domcontentloaded", { timeout: 10000 })
                        ]).catch(() => undefined);
                    }
                }
                let reachedGoals = false;
                for (let i = 0; i < 4; i += 1) {
                    await page.goto(goalsUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
                    try {
                        await this.ensureGoalsWorkspaceVisible();
                        reachedGoals = true;
                        break;
                    }
                    catch (error) {
                        lastError = error instanceof Error ? error : new Error(String(error));
                        await page.waitForTimeout(1500);
                    }
                }
                if (reachedGoals) {
                    await this.persistAuthState();
                    return { loggedIn: true, url: page.url() };
                }
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            }
            await page.waitForTimeout(1500);
        }
        throw lastError ?? new Error("login failed after retries");
    }
    async setState(session, patch) {
        const page = this.ensurePage();
        const key = this.storageKeyFor(session);
        const updated = await page.evaluate(({ storageKey, incoming }) => {
            const currentRaw = window.localStorage.getItem(storageKey);
            const current = currentRaw ? JSON.parse(currentRaw) : {};
            const next = {
                ...current,
                ...incoming,
                updatedAt: new Date().toISOString()
            };
            window.localStorage.setItem(storageKey, JSON.stringify(next));
            return next;
        }, { storageKey: key, incoming: patch });
        return updated;
    }
    async getState(session) {
        const page = this.ensurePage();
        const key = this.storageKeyFor(session);
        const state = await page.evaluate((storageKey) => {
            const raw = window.localStorage.getItem(storageKey);
            return raw ? JSON.parse(raw) : {};
        }, key);
        return state;
    }
    async talkToGuide(message) {
        await this.ensureOnGoals();
        return this.sendCoachMessage(message);
    }
    async talkToGoalChat(message, goalTitle) {
        if (goalTitle) {
            await this.openGoalContext(goalTitle);
        }
        else {
            await this.ensureOnGoals();
        }
        await this.sendCoachMessage(message);
        return { sent: true, goalTitle };
    }
    async sendCoachMessage(message) {
        if (!message.trim()) {
            throw new Error("message is required");
        }
        const input = await this.resolveChatInput();
        await input.fill(message);
        const sent = await this.tryClickByText(this.pageOrThrow(), ["Send", "GO", "submit"], input.locator("xpath=ancestor::*[self::form or self::div][1]"));
        if (!sent) {
            await input.press("Meta+Enter");
        }
        return { sent: true };
    }
    async readCoachMessages() {
        const page = this.ensurePage();
        const byConfiguredSelector = page.locator(config.COACH_MESSAGE_SELECTOR);
        if ((await byConfiguredSelector.count()) > 0) {
            return byConfiguredSelector
                .allTextContents()
                .then((messages) => messages.map((m) => m.trim()).filter((m) => m.length > 0));
        }
        const generic = page.locator('[class*="message"], [data-role*="message"], [data-testid*="message"]');
        if ((await generic.count()) === 0) {
            return [];
        }
        const messages = await generic.allTextContents();
        return messages.map((m) => m.trim()).filter((m) => m.length > 0);
    }
    async brainstormDesiresForEachCategory(itemsByCategory) {
        const page = this.ensurePage();
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming/desires-selection/category`, {
            waitUntil: "domcontentloaded"
        });
        let added = 0;
        const categories = Object.keys(itemsByCategory);
        for (const category of categories) {
            await this.clickByText(page, [category.toUpperCase(), this.titleCase(category)]);
            const rawItems = itemsByCategory[category];
            const items = Array.isArray(rawItems) ? rawItems.map((v) => String(v)).filter((v) => v.trim().length > 0) : [];
            for (const item of items) {
                const field = await this.resolveDesireInput();
                await field.fill(item);
                const clicked = await this.tryClickByText(page, ["Add", "ADD"]);
                if (!clicked) {
                    await field.press("Enter");
                }
                added += 1;
            }
        }
        return { categoriesUpdated: categories, itemsAdded: added };
    }
    async feelOutDesires(rawDesires) {
        const page = this.ensurePage();
        const desires = rawDesires.map((v) => String(v)).filter((v) => v.trim().length > 0);
        const processed = [];
        for (const desire of desires) {
            await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });
            await this.openDesireForViewing(desire);
            const notes = page.locator("textarea").filter({ hasNotText: "Type your message" }).first();
            if ((await notes.count()) > 0) {
                const noteText = `Resonance check for ${desire}: feels actionable and meaningful.`;
                await notes.fill(noteText);
            }
            await this.tryClickByText(page, ["SAVE", "Save"]);
            processed.push(desire);
        }
        return { processed };
    }
    async createGoalsFromDesires(rawDesires) {
        const desires = rawDesires
            .map((entry) => {
            if (typeof entry === "string") {
                return { title: entry };
            }
            if (typeof entry === "object" && entry !== null) {
                const obj = entry;
                return {
                    title: String(obj.title ?? ""),
                    category: this.asOptionalString(obj.category),
                    dueDate: this.asOptionalString(obj.dueDate)
                };
            }
            return { title: "" };
        })
            .filter((entry) => entry.title.trim().length > 0);
        const created = [];
        for (const desire of desires) {
            const promoted = await this.tryPromoteDesireToGoal(desire.title);
            if (!promoted) {
                await this.createGoal(desire);
            }
            created.push(desire.title);
        }
        return { created };
    }
    async createGoal(input) {
        const page = this.ensurePage();
        if (!input.title.trim()) {
            throw new Error("create_goal requires title");
        }
        await this.ensureOnGoals();
        const activeBefore = await this.readGoalCount("Active");
        const opened = await this.tryClickByText(page, [
            "NEW GOAL",
            "(I KNOW WHAT MY GOAL IS)",
            "I KNOW WHAT MY GOAL IS",
            "Create a New Goal"
        ]);
        if (!opened) {
            const fallback = page.getByText(/I KNOW WHAT MY GOAL IS/i).first();
            if ((await fallback.count()) > 0) {
                await fallback.scrollIntoViewIfNeeded().catch(() => undefined);
                await fallback.click({ timeout: 2000 });
            }
            else {
                throw new Error("could not open create-goal flow");
            }
        }
        await page.waitForTimeout(200);
        const form = await this.resolveCreateGoalPanel();
        const titleField = await this.resolveGoalTitleInput(form ?? undefined);
        await titleField.fill(input.title);
        if (input.category) {
            const categorySet = await this.selectCreateGoalCategory(input.category);
            if (!categorySet) {
                throw new Error(`could not select create_goal category: ${input.category}`);
            }
        }
        if (input.dueDate) {
            const due = (form ?? page).locator('input[type="date"]').first();
            if ((await due.count()) > 0) {
                const normalized = this.normalizeDateInput(input.dueDate);
                if (normalized) {
                    await due.fill(normalized);
                }
            }
        }
        let submitted = false;
        const createResponsePromise = page
            .waitForResponse((res) => res.request().method() === "POST" && /\/goals(\?|$)/.test(res.url()), { timeout: 10000 })
            .catch(() => null);
        const createBtn = page.getByRole("button", { name: /^create goal$/i }).first();
        if ((await createBtn.count()) > 0 && (await createBtn.isVisible().catch(() => false))) {
            try {
                await createBtn.click({ timeout: 2000 });
                submitted = true;
            }
            catch {
                submitted = false;
            }
        }
        if (!submitted) {
            submitted = await this.tryClickByText(form ?? page, ["Create Goal", "Create", "Save", "Add Goal", "Done"]);
        }
        if (!submitted) {
            const domClicked = await page.evaluate(() => {
                const button = Array.from(document.querySelectorAll("button")).find((el) => (el.textContent || "").trim().toLowerCase() === "create goal");
                if (!button) {
                    return false;
                }
                button.click();
                return true;
            });
            submitted = domClicked;
        }
        if (!submitted) {
            await titleField.press("Enter");
        }
        const deadline = Date.now() + 10000;
        let serverError = null;
        const createResponse = await createResponsePromise;
        if (createResponse) {
            try {
                const raw = await createResponse.text();
                const match = raw.match(/"success":false,"error":"([^"]+)"/);
                if (match?.[1]) {
                    serverError = match[1];
                }
            }
            catch {
                serverError = null;
            }
        }
        while (Date.now() < deadline) {
            if (await this.isGoalContextOpen(input.title)) {
                return { created: true, title: input.title };
            }
            await this.ensureOnGoals();
            const activeAfter = await this.readGoalCount("Active");
            if (activeBefore !== null && activeAfter !== null && activeAfter > activeBefore) {
                return { created: true, title: input.title };
            }
            await page.waitForTimeout(300);
        }
        const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
        if (serverError) {
            throw new Error(`create_goal failed: ${serverError}`);
        }
        throw new Error(`create_goal submission did not increase active goal count (before=${activeBefore} title=${input.title} snippet=${snippet})`);
    }
    async readGoalsOverview() {
        const page = this.pageOrThrow();
        await this.ensureOnGoals();
        const auth = await this.readAuthState();
        const result = await page.evaluate(() => {
            const text = document.body.innerText || "";
            const lines = text.split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const filterCounts = {};
            for (const match of text.matchAll(/\b(Active|Complete|Archived|All)\s*\((\d+)\)/gi)) {
                filterCounts[match[1].toLowerCase()] = Number(match[2]);
            }
            const categoryCounts = [];
            const categories = ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"];
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                const category = categories.find((name) => line.toLowerCase() === name.toLowerCase());
                if (!category)
                    continue;
                const prev = lines[i - 1] ?? "";
                const count = Number(prev);
                if (!Number.isNaN(count)) {
                    categoryCounts.push({ category, count });
                }
            }
            const guidePrompt = lines.find((line) => /Don't know where to start|guide you towards one of your goals/i.test(line));
            const visibleGoals = lines.filter((line) => line.length > 2 &&
                !/SELF-IMPROVE|GET TO WORK ON A GOAL|SELF-AWARENESS|LEARN ABOUT YOURSELF AND GET BETTER GUIDANCE|COMMUNITY|JOIN OTHER SELF-MAXERS|\(AND HM\) ON DISCORD|GOAL CATEGORIES|YOUR GOALS|SHOW GOALS|NEW GOAL|LIFESTORMING|SELF-MAX GUIDE|DON'T KNOW WHERE TO START|HELP|MORE|Health|Work|Love|Family|Social|Fun|Dreams|Meaning|Active|Complete|Archived|All/i.test(line)).slice(0, 20);
            return {
                guidePrompt,
                filterCounts,
                categoryCounts,
                visibleGoals,
                snippet: text.replace(/\s+/g, " ").slice(0, 800)
            };
        });
        return { url: page.url(), auth, ...result };
    }
    async readAuthState() {
        const archivedCount = await this.readGoalCount("Archived");
        const activeCount = await this.readGoalCount("Active");
        const completeCount = await this.readGoalCount("Complete");
        const allCount = await this.readGoalCount("All");
        return {
            valid: await this.isGoalsWorkspaceVisible(),
            archivedCount,
            activeCount,
            completeCount,
            allCount
        };
    }
    async readCurrentRoute() {
        const page = this.pageOrThrow();
        const url = page.url();
        return {
            url,
            routeId: this.matchKnownRoute(url),
            params: this.extractRouteParams(url)
        };
    }
    async readKnownRoutes() {
        return knownRoutes;
    }
    async readRouteSnapshot(route, explicitUrl) {
        const page = this.pageOrThrow();
        if (explicitUrl) {
            await page.goto(explicitUrl, { waitUntil: "domcontentloaded" });
        }
        else if (route) {
            const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
            const path = route.startsWith("/") ? route : `/${route}`;
            await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
        }
        const result = await page.evaluate(() => {
            const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
                .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
                .filter(Boolean)
                .slice(0, 20);
            const buttonTexts = Array.from(document.querySelectorAll("button,[role='button'],a"))
                .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
                .filter(Boolean)
                .slice(0, 30);
            const inputPlaceholders = Array.from(document.querySelectorAll("input,textarea"))
                .map((el) => ("placeholder" in el ? String(el.placeholder || "").trim() : ""))
                .filter(Boolean)
                .slice(0, 20);
            return {
                headingCandidates: headings,
                buttonTexts,
                inputPlaceholders,
                snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
            };
        });
        const onGoals = /\/goals(\?|$)/.test(page.url());
        return { url: page.url(), auth: onGoals ? await this.readAuthState() : undefined, ...result };
    }
    async readPageSections(route, explicitUrl) {
        const page = this.pageOrThrow();
        await this.navigateForRead(route, explicitUrl);
        const result = await page.evaluate(() => {
            const normalize = (value) => value.replace(/\s+/g, " ").trim();
            const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
                .map((el) => normalize(el.textContent || ""))
                .filter(Boolean)
                .slice(0, 30);
            const paragraphs = Array.from(document.querySelectorAll("p, li"))
                .map((el) => normalize(el.textContent || ""))
                .filter((text) => text.length >= 20)
                .slice(0, 40);
            const formLabels = Array.from(document.querySelectorAll("label, legend"))
                .map((el) => normalize(el.textContent || ""))
                .filter(Boolean)
                .slice(0, 30);
            const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
                .map((el) => normalize(el.textContent || ""))
                .filter(Boolean)
                .slice(0, 30);
            const links = Array.from(document.querySelectorAll("a[href]"))
                .map((el) => ({
                text: normalize(el.textContent || ""),
                href: el.href || ""
            }))
                .filter((item) => item.href)
                .slice(0, 40);
            return {
                title: document.title || "",
                headings,
                paragraphs,
                formLabels,
                buttons,
                links,
                snippet: normalize(document.body.innerText || "").slice(0, 1200)
            };
        });
        return {
            url: page.url(),
            routeId: this.matchKnownRoute(page.url()),
            title: result.title || undefined,
            headings: result.headings,
            paragraphs: result.paragraphs,
            formLabels: result.formLabels,
            buttons: result.buttons,
            links: result.links,
            snippet: result.snippet
        };
    }
    async discoverLinks(route, explicitUrl) {
        const page = this.pageOrThrow();
        await this.navigateForRead(route, explicitUrl);
        const links = await page.evaluate(() => {
            const normalize = (value) => value.replace(/\s+/g, " ").trim();
            return Array.from(document.querySelectorAll("a[href]"))
                .map((el) => ({
                text: normalize(el.textContent || ""),
                href: el.href || ""
            }))
                .filter((item) => item.href);
        });
        return {
            url: page.url(),
            routeId: this.matchKnownRoute(page.url()),
            links: links.map((link) => ({ ...link, routeId: this.matchKnownRoute(link.href) }))
        };
    }
    async listGoals(filter) {
        const page = this.pageOrThrow();
        await this.ensureOnGoals();
        const auth = await this.readAuthState();
        const normalized = filter.trim().toLowerCase();
        if (normalized === "active") {
            await this.tryClickByText(page, ["Active"]);
        }
        else if (normalized === "complete") {
            await this.tryClickByText(page, ["Complete"]);
        }
        else if (normalized === "archived") {
            await this.tryClickByText(page, ["Archived"]);
        }
        else {
            await this.tryClickByText(page, ["All"]);
        }
        const goals = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("article, section, li, div"));
            const extracted = [];
            const categories = ["health", "work", "love", "family", "social", "fun", "dreams", "meaning"];
            for (const row of rows) {
                const text = (row.textContent || "").replace(/\s+/g, " ").trim();
                if (!text || !/start|tasks completed|due/i.test(text)) {
                    continue;
                }
                const lines = (row.textContent || "")
                    .split(/\n+/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                const title = lines.find((line) => !/start|view|archive|complete|due|tasks completed|meaning|health|work|love|family|social|fun|dreams/i.test(line)) ?? "";
                if (!title || title.length < 2) {
                    continue;
                }
                const html = row.outerHTML;
                const idMatch = html.match(/goalId=([A-Za-z0-9_-]+)/i) ?? html.match(/data-goal-id=["']?([A-Za-z0-9_-]+)/i);
                const category = lines.find((line) => categories.includes(line.toLowerCase()));
                const dueLabel = lines.find((line) => /^Due\s/i.test(line));
                const progressLabel = lines.find((line) => /tasks completed|\d+%/i.test(line));
                const summaryIndex = lines.findIndex((line) => /tasks completed|No tasks/i.test(line));
                const taskSummaryLabel = summaryIndex !== -1 ? lines[summaryIndex] : undefined;
                const taskPreviewItems = lines
                    .filter((line) => line !== title &&
                    line !== category &&
                    line !== dueLabel &&
                    line !== progressLabel &&
                    line !== taskSummaryLabel &&
                    !/^(START|ADD TASKS)$/i.test(line) &&
                    line.length > 0)
                    .slice(0, 12);
                const taskPanelState = taskSummaryLabel && /tasks completed/i.test(taskSummaryLabel)
                    ? "tasks_present"
                    : /No tasks/i.test(taskSummaryLabel ?? "") || lines.some((line) => /^ADD TASKS$/i.test(line))
                        ? "add_tasks"
                        : "empty";
                extracted.push({ title, goalId: idMatch?.[1], category, dueLabel, progressLabel, taskSummaryLabel, taskPreviewItems, taskPanelState });
            }
            const dedup = new Map();
            for (const item of extracted) {
                if (!dedup.has(item.title)) {
                    dedup.set(item.title, item);
                }
            }
            return [...dedup.values()];
        });
        const summaryGoals = await page.evaluate(() => {
            const lines = (document.body.innerText || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
            const filters = new Set(["Active", "Complete", "Archived", "All"]);
            const categories = new Set(["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"]);
            const out = [];
            let inGoals = false;
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                if (/^YOUR GOALS$/i.test(line)) {
                    inGoals = true;
                    continue;
                }
                if (!inGoals)
                    continue;
                if (filters.has(line.replace(/\s*\(\d+\)$/, "")) || /^SHOW GOALS:?$/i.test(line)) {
                    continue;
                }
                if (/^No .* goals found\.?$/i.test(line)) {
                    break;
                }
                const next = lines[i + 1] ?? "";
                const next2 = lines[i + 2] ?? "";
                const next3 = lines[i + 3] ?? "";
                if (categories.has(next) && /^Due\s/i.test(next2)) {
                    const tail = lines.slice(i + 4, i + 20);
                    const startIdx = tail.findIndex((line) => /^START$/i.test(line));
                    const segment = startIdx === -1 ? tail : tail.slice(0, startIdx);
                    const taskSummaryLabel = segment.find((line) => /tasks completed|No tasks/i.test(line));
                    const taskPreviewItems = segment.filter((line) => line !== taskSummaryLabel &&
                        !/^\d+%$/i.test(line) &&
                        !/^ADD TASKS$/i.test(line) &&
                        line.length > 0);
                    const taskPanelState = taskSummaryLabel && /tasks completed/i.test(taskSummaryLabel)
                        ? "tasks_present"
                        : segment.some((line) => /^ADD TASKS$/i.test(line))
                            ? "add_tasks"
                            : "empty";
                    out.push({
                        title: line,
                        category: next,
                        dueLabel: next2,
                        progressLabel: /%|tasks completed/i.test(next3) ? next3 : undefined,
                        taskSummaryLabel,
                        taskPreviewItems: taskPreviewItems.slice(0, 12),
                        taskPanelState
                    });
                }
            }
            const dedup = new Map();
            for (const item of out) {
                if (!dedup.has(item.title))
                    dedup.set(item.title, item);
            }
            return [...dedup.values()];
        });
        let extractedGoals = goals;
        if (summaryGoals.length > 0) {
            const merged = new Map();
            for (const item of goals) {
                merged.set(item.title, item);
            }
            for (const summary of summaryGoals) {
                const existing = merged.get(summary.title);
                merged.set(summary.title, {
                    ...existing,
                    ...summary,
                    goalId: existing?.goalId
                });
            }
            extractedGoals = [...merged.values()];
        }
        else if (extractedGoals.length === 0) {
            extractedGoals = summaryGoals;
        }
        for (const goal of extractedGoals) {
            if (goal.goalId) {
                this.cacheGoal({
                    goalId: goal.goalId,
                    title: goal.title,
                    category: goal.category,
                    dueLabel: goal.dueLabel,
                    progressLabel: goal.progressLabel,
                    taskPanelState: goal.taskPanelState,
                    taskSummaryLabel: goal.taskSummaryLabel,
                    taskPreviewItems: goal.taskPreviewItems
                });
            }
        }
        return { filter: normalized, auth, goals: extractedGoals };
    }
    async surveyActiveGoalTaskStates() {
        const listed = await this.listGoals("active");
        const goals = listed.goals.map((goal) => ({
            title: goal.title,
            goalId: goal.goalId,
            category: goal.category,
            progressLabel: goal.progressLabel,
            taskSummaryLabel: goal.taskSummaryLabel,
            taskPreviewItems: goal.taskPreviewItems,
            taskPanelState: goal.taskPanelState ?? "empty"
        }));
        const counts = { tasks_present: 0, add_tasks: 0, empty: 0 };
        for (const goal of goals) {
            counts[goal.taskPanelState] += 1;
        }
        return { goals, counts };
    }
    async getGoalTaskSummary(goalTitle, goalId) {
        if (goalId) {
            const cached = this.entityCache.goalsById[goalId];
            if (cached?.taskPanelState) {
                return {
                    goalId,
                    title: cached.title ?? goalTitle ?? goalId,
                    taskPanelState: cached.taskPanelState,
                    taskSummaryLabel: cached.taskSummaryLabel,
                    taskPreviewItems: cached.taskPreviewItems
                };
            }
        }
        const listed = await this.listGoals("active");
        const match = listed.goals.find((goal) => (goalId && goal.goalId === goalId) || (goalTitle && goal.title === goalTitle));
        if (!match) {
            return null;
        }
        return {
            goalId: match.goalId,
            title: match.title,
            taskPanelState: match.taskPanelState ?? "empty",
            taskSummaryLabel: match.taskSummaryLabel,
            taskPreviewItems: match.taskPreviewItems
        };
    }
    async discoverGoalIds(waitMs) {
        const page = this.pageOrThrow();
        await this.ensureOnGoals();
        const wait = typeof waitMs === "number" && Number.isFinite(waitMs) ? Math.max(0, Math.min(waitMs, 30000)) : 4000;
        const chunks = [];
        const onResponse = async (res) => {
            const url = res.url();
            if (!/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/i.test(url)) {
                return;
            }
            try {
                const text = await res.text();
                if (text) {
                    chunks.push(text.slice(0, 200_000));
                }
            }
            catch {
                // ignore stream body read failures
            }
        };
        page.on("response", onResponse);
        try {
            await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
            await page.waitForTimeout(wait);
        }
        finally {
            page.off("response", onResponse);
        }
        const source = chunks.join("\n");
        const ids = new Set();
        for (const match of source.matchAll(/documents\/goals\/([A-Za-z0-9_-]+)/g)) {
            if (match[1])
                ids.add(match[1]);
        }
        for (const match of source.matchAll(/"goalId":"([A-Za-z0-9_-]+)"/g)) {
            if (match[1])
                ids.add(match[1]);
        }
        for (const match of source.matchAll(/goalId=([A-Za-z0-9_-]+)/g)) {
            if (match[1])
                ids.add(match[1]);
        }
        const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        return { goalIds: [...ids], waitMs: wait, loadingVisible: /loading/i.test(bodyText) };
    }
    async discoverGoals(waitMs) {
        const page = this.pageOrThrow();
        await this.ensureOnGoals();
        const dom = await page.evaluate(() => {
            const items = [];
            const seen = new Set();
            const push = (goalId, title) => {
                if (!goalId || seen.has(goalId))
                    return;
                seen.add(goalId);
                items.push({ goalId, title: title?.trim() || undefined });
            };
            for (const link of Array.from(document.querySelectorAll("a[href]"))) {
                const href = link.getAttribute("href") || "";
                const match = href.match(/goalId=([A-Za-z0-9_-]+)/i);
                if (!match?.[1])
                    continue;
                const card = link.closest("article,section,li,div");
                const text = (card?.textContent || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
                const title = text.find((line) => line.length > 2 && !/start|due|tasks completed|health|work|love|family|social|fun|dreams|meaning/i.test(line));
                push(match[1], title);
            }
            for (const el of Array.from(document.querySelectorAll("[data-goal-id], [data-goalid], [goalid]"))) {
                const value = el.getAttribute("data-goal-id") ?? el.getAttribute("data-goalid") ?? el.getAttribute("goalid") ?? "";
                if (/^[A-Za-z0-9_-]{8,}$/.test(value))
                    push(value);
            }
            return items;
        });
        const stream = await this.discoverGoalIds(waitMs);
        const streamIds = stream.goalIds;
        const merged = new Map();
        for (const item of dom) {
            merged.set(item.goalId, item);
        }
        for (const id of streamIds) {
            if (!merged.has(id))
                merged.set(id, { goalId: id });
        }
        if (merged.size === 0) {
            const listed = await this.listGoals("active");
            for (const goal of listed.goals) {
                try {
                    await this.openGoalContext(goal.title);
                    const resolvedId = this.goalIdFromUrl(this.pageOrThrow().url());
                    if (resolvedId) {
                        merged.set(resolvedId, { goalId: resolvedId, title: goal.title });
                        this.cacheGoal({
                            goalId: resolvedId,
                            title: goal.title,
                            category: goal.category,
                            dueLabel: goal.dueLabel,
                            progressLabel: goal.progressLabel
                        });
                    }
                }
                catch {
                    // ignore per-goal discovery failures
                }
            }
            await this.ensureOnGoals();
        }
        return {
            goals: [...merged.values()],
            sources: { domGoalIds: dom.length, streamGoalIds: streamIds.length },
            waitMs: stream.waitMs,
            loadingVisible: stream.loadingVisible
        };
    }
    async readGoal(goalTitle, goalId) {
        await this.openGoalForRead(goalTitle, goalId);
        const page = this.pageOrThrow();
        const workspaceVisible = await this.isGoalWorkspaceVisible();
        const snippet = await this.readBodySnippet();
        const snapshot = await page.evaluate(() => {
            const names = ["DESIRE", "ENVIRONMENT", "MENTALITY", "ACTIONS", "SITUATION", "FEEDBACK"];
            const textLines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const blocks = [];
            for (const name of names) {
                const idx = textLines.findIndex((line) => line.toUpperCase() === name);
                if (idx === -1)
                    continue;
                const state = textLines[idx + 1] ?? "";
                const prompts = [];
                for (let i = idx + 2; i < Math.min(textLines.length, idx + 8); i += 1) {
                    const line = textLines[i];
                    if (names.includes(line.toUpperCase()))
                        break;
                    if (line.length > 0)
                        prompts.push(line);
                }
                blocks.push({ name, state, prompts });
            }
            const title = (() => {
                const lines = textLines;
                const marker = lines.findIndex((line) => /Current Goal/i.test(line));
                if (marker !== -1)
                    return lines[marker + 1] || "";
                return "";
            })();
            return {
                url: location.href,
                title,
                statusBlocks: blocks
            };
        });
        const resolvedGoalId = goalId ?? this.goalIdFromUrl(snapshot.url);
        const resolvedGoalTitle = goalTitle ?? (snapshot.title || undefined);
        if (resolvedGoalId) {
            this.cacheGoal({ goalId: resolvedGoalId, title: resolvedGoalTitle });
        }
        return {
            goalId: resolvedGoalId,
            goalTitle: resolvedGoalTitle,
            url: snapshot.url,
            workspaceVisible,
            snippet,
            statusBlocks: snapshot.statusBlocks
        };
    }
    async readGoalMetadata(goalTitle, goalId) {
        await this.openGoalForRead(goalTitle, goalId);
        const page = this.pageOrThrow();
        const result = await page.evaluate(() => {
            const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const currentGoalIndex = lines.findIndex((line) => /Current Goal/i.test(line));
            const currentGoal = currentGoalIndex !== -1 ? lines[currentGoalIndex + 1] || "" : "";
            const categories = ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"];
            const category = lines.find((line) => categories.includes(line)) || "";
            const dueLabel = lines.find((line) => /^Due\s/i.test(line)) || "";
            const progressLabel = lines.find((line) => /\d+\/\d+\s+tasks completed|\d+%/i.test(line)) || "";
            return {
                currentGoal,
                category,
                dueLabel,
                progressLabel,
                snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
            };
        });
        const resolvedGoalId = goalId ?? this.goalIdFromUrl(page.url());
        const resolvedGoalTitle = goalTitle ?? (result.currentGoal || undefined);
        if (resolvedGoalId) {
            this.cacheGoal({
                goalId: resolvedGoalId,
                title: resolvedGoalTitle,
                category: result.category || undefined,
                dueLabel: result.dueLabel || undefined,
                progressLabel: result.progressLabel || undefined
            });
        }
        return {
            goalId: resolvedGoalId,
            goalTitle: resolvedGoalTitle,
            url: page.url(),
            workspaceVisible: await this.isGoalWorkspaceVisible(),
            category: result.category || undefined,
            dueLabel: result.dueLabel || undefined,
            progressLabel: result.progressLabel || undefined,
            snippet: result.snippet
        };
    }
    async readGoalFull(goalTitle, goalId) {
        const goal = await this.readGoal(goalTitle, goalId);
        const metadata = await this.readGoalMetadata(goalTitle, goalId);
        const chat = await this.readGoalChat(goalTitle, goalId);
        const tasks = await this.listGoalTasks(goalTitle, goalId);
        const resolvedGoalId = goal.goalId ?? metadata.goalId ?? chat.goalId ?? tasks.goalId;
        const resolvedGoalTitle = goal.goalTitle ?? metadata.goalTitle ?? chat.goalTitle ?? tasks.goalTitle;
        if (resolvedGoalId) {
            this.cacheGoal({
                goalId: resolvedGoalId,
                title: resolvedGoalTitle,
                category: metadata.category,
                dueLabel: metadata.dueLabel,
                progressLabel: metadata.progressLabel
            });
        }
        return {
            goalId: resolvedGoalId,
            goalTitle: resolvedGoalTitle,
            url: goal.url,
            workspaceVisible: goal.workspaceVisible && metadata.workspaceVisible,
            category: metadata.category,
            dueLabel: metadata.dueLabel,
            progressLabel: metadata.progressLabel,
            statusBlocks: goal.statusBlocks,
            messages: chat.messages,
            tasks: tasks.tasks,
            taskReadReason: tasks.reason,
            snippet: goal.snippet
        };
    }
    async readCachedGoals() {
        return {
            goals: Object.values(this.entityCache.goalsById).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        };
    }
    async readCachedDesires() {
        return {
            desires: Object.values(this.entityCache.desiresById).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        };
    }
    async readTaskPanelSnapshot(goalTitle, goalId) {
        await this.openGoalForRead(goalTitle, goalId);
        const page = this.pageOrThrow();
        await this.openTaskPanel();
        const panel = await this.resolveTaskPanel();
        const taskPanelVisible = Boolean(panel && (await panel.count()) > 0);
        const result = await page.evaluate(() => {
            const normalize = (value) => value.replace(/\s+/g, " ").trim();
            const candidates = Array.from(document.querySelectorAll("body *")).filter((el) => /TASKS|Add new task|Use the task suggestion tool|How will you accomplish|Select Tasks/i.test(normalize(el.innerText || el.textContent || "")));
            return {
                nearbyTexts: candidates
                    .slice(0, 20)
                    .map((el) => normalize(el.innerText || el.textContent || ""))
                    .filter(Boolean),
                nearbyHtml: candidates.slice(0, 10).map((el) => el.outerHTML.slice(0, 600)),
                snippet: normalize(document.body.innerText || "").slice(0, 1200)
            };
        });
        return {
            goalId: goalId ?? this.goalIdFromUrl(page.url()),
            goalTitle,
            url: page.url(),
            taskPanelVisible,
            taskPanelText: panel ? ((await panel.innerText().catch(() => "")).replace(/\s+/g, " ").trim() || undefined) : undefined,
            nearbyTexts: result.nearbyTexts,
            nearbyHtml: result.nearbyHtml,
            snippet: result.snippet
        };
    }
    async readGoalWorkspace(goalTitle, goalId) {
        await this.openGoalForRead(goalTitle, goalId);
        const page = this.pageOrThrow();
        const result = await page.evaluate(() => {
            const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const tabs = lines.filter((line) => /^(BACK|EDIT|TASKS)$/i.test(line));
            const idx = lines.findIndex((line) => /Current Goal/i.test(line));
            const currentGoal = idx !== -1 ? lines[idx + 1] || "" : "";
            return {
                tabs,
                currentGoal,
                snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
            };
        });
        return {
            goalId: goalId ?? this.goalIdFromUrl(page.url()),
            goalTitle: goalTitle ?? (result.currentGoal || undefined),
            url: page.url(),
            workspaceVisible: await this.isGoalWorkspaceVisible(),
            tabs: result.tabs,
            currentGoal: result.currentGoal || undefined,
            snippet: result.snippet
        };
    }
    async listGoalTasks(goalTitle, goalId) {
        const summary = await this.getGoalTaskSummary(goalTitle, goalId);
        if (summary?.taskPanelState === "add_tasks") {
            return {
                goalId: goalId ?? summary.goalId,
                goalTitle: goalTitle ?? summary.title,
                url: this.pageOrThrow().url(),
                workspaceVisible: false,
                reason: summary.taskSummaryLabel ?? "No tasks",
                snippet: await this.readBodySnippet().catch(() => ""),
                tasks: []
            };
        }
        if (summary?.taskPanelState === "tasks_present" && (summary.taskPreviewItems?.length ?? 0) > 0) {
            return {
                goalId: goalId ?? summary.goalId,
                goalTitle: goalTitle ?? summary.title,
                url: this.pageOrThrow().url(),
                workspaceVisible: false,
                reason: summary.taskSummaryLabel,
                snippet: await this.readBodySnippet().catch(() => ""),
                tasks: summary.taskPreviewItems.map((text) => ({ text, completed: false }))
            };
        }
        await this.openGoalForRead(goalTitle, goalId);
        const page = this.pageOrThrow();
        try {
            await this.ensureOnGoalTaskContext(undefined);
        }
        catch (error) {
            return {
                goalId: goalId ?? this.goalIdFromUrl(page.url()),
                goalTitle,
                url: page.url(),
                workspaceVisible: await this.isGoalWorkspaceVisible(),
                reason: error instanceof Error ? error.message : String(error),
                snippet: await this.readBodySnippet(),
                tasks: []
            };
        }
        const taskPanelVisible = await this.isTaskPanelVisible();
        if (!taskPanelVisible) {
            return {
                goalId: goalId ?? this.goalIdFromUrl(page.url()),
                goalTitle,
                url: page.url(),
                workspaceVisible: await this.isGoalWorkspaceVisible(),
                reason: "task panel content not visible",
                snippet: await this.readBodySnippet(),
                tasks: []
            };
        }
        const tasks = await page.evaluate(() => {
            const normalize = (value) => value.replace(/\s+/g, " ").trim();
            const noise = /^(Add new task|Use the task suggestion tool|Select Tasks|Cancel|Set Tasks|Type your message|⌘ \+ Enter to send|TASKS)$/i;
            const taskLike = (text) => /\b(research|discuss|reach out|plan|schedule|call|book|create|begin|talk|choose|review|write|set up|find|contact)\b/i.test(text) ||
                text.length > 18;
            const out = [];
            const panelAnchor = Array.from(document.querySelectorAll("body *")).find((el) => /How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(normalize(el.innerText || el.textContent || "")));
            const panelRoot = panelAnchor?.closest("section,article,div") ?? panelAnchor?.parentElement ?? null;
            const collectFromScope = (root) => {
                for (const row of Array.from(root.querySelectorAll("li, article, section, div"))) {
                    const raw = normalize(row.innerText || row.textContent || "");
                    if (!raw || noise.test(raw) || /How will you accomplish|Tasks are generated based/i.test(raw))
                        continue;
                    const checkbox = row.querySelector('input[type="checkbox"]');
                    const completed = checkbox ? Boolean(checkbox.checked) : /\b(completed|done)\b/i.test(raw);
                    const lines = raw.split(/\n+/).map(normalize).filter(Boolean);
                    const candidate = lines.find((line) => !noise.test(line) && !/^(How will you accomplish|Tasks are generated based)/i.test(line) && taskLike(line));
                    if (checkbox || candidate) {
                        const text = candidate ?? raw;
                        if (text.length > 3)
                            out.push({ text, completed });
                    }
                }
            };
            if (panelRoot) {
                collectFromScope(panelRoot);
            }
            const lines = (document.body.innerText || "").split(/\n+/).map(normalize).filter(Boolean);
            const start = lines.findIndex((line) => /How will you accomplish/i.test(line));
            if (start !== -1) {
                for (let i = start + 1; i < lines.length; i += 1) {
                    const line = lines[i];
                    if (noise.test(line) || /Tasks are generated based/i.test(line))
                        break;
                    if (/Current Goal|GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK/i.test(line))
                        continue;
                    if (taskLike(line)) {
                        out.push({ text: line, completed: false });
                    }
                }
            }
            const dedup = new Map();
            for (const item of out) {
                if (item.text.length > 3 &&
                    !/SELF-IMPROVE|SELF-AWARENESS|COMMUNITY|CURRENT GOAL|GOAL STATUS|Not yet updated|What do you|Where can you|How are you thinking|What did you learn|Hello, I’m here to help/i.test(item.text) &&
                    !dedup.has(item.text)) {
                    dedup.set(item.text, item);
                }
            }
            return [...dedup.values()];
        });
        const resolvedGoalId = goalId ?? this.goalIdFromUrl(page.url());
        if (resolvedGoalId) {
            this.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
        }
        return {
            goalId: resolvedGoalId,
            goalTitle,
            url: page.url(),
            workspaceVisible: await this.isGoalWorkspaceVisible(),
            reason: tasks.length === 0 ? "no visible tasks extracted" : undefined,
            snippet: await this.readBodySnippet(),
            tasks
        };
    }
    async readGoalChat(goalTitle, goalId) {
        await this.openGoalForRead(goalTitle, goalId);
        await this.waitForGoalDataLoaded();
        const page = this.pageOrThrow();
        let messages = await this.readCoachMessages();
        if (messages.length === 0) {
            messages = await page.evaluate(() => {
                const lines = (document.body.innerText || "")
                    .split(/\n+/)
                    .map((v) => v.trim())
                    .filter(Boolean);
                const idx = lines.findIndex((line) => /Type your message/i.test(line));
                if (idx <= 0) {
                    return lines.filter((line) => /hello|help you|goal of|important to you|guide you/i.test(line)).slice(-8);
                }
                const out = [];
                for (let i = Math.max(0, idx - 12); i < idx; i += 1) {
                    const line = lines[i];
                    if (/GOAL STATUS|DESIRE|ENVIRONMENT|MENTALITY|ACTIONS|SITUATION|FEEDBACK|CURRENT GOAL|BACK|EDIT|TASKS/i.test(line)) {
                        continue;
                    }
                    if (line.length > 6) {
                        out.push(line);
                    }
                }
                return out;
            });
        }
        const resolvedGoalId = goalId ?? this.goalIdFromUrl(page.url());
        if (resolvedGoalId) {
            this.cacheGoal({ goalId: resolvedGoalId, title: goalTitle });
        }
        return {
            goalId: resolvedGoalId,
            goalTitle,
            url: page.url(),
            messages
        };
    }
    async readLifestormingOverview() {
        const page = this.pageOrThrow();
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        await page.goto(`${base}/lifestorming`, { waitUntil: "domcontentloaded" });
        await this.waitForPageTextNotContaining("Loading Lifestorming Page...", 8000);
        const result = await page.evaluate(() => {
            const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const stepTexts = lines.filter((line) => /^STEP\s+\d+:|^Step\s+\d+:|^LIFESTORMING$|^BRAINSTORM$|^YOUR LIFE$/i.test(line)).slice(0, 16);
            const visibleDesires = lines.filter((line) => line.length > 2 &&
                !/SELF-IMPROVE|SELF-AWARENESS|COMMUNITY|Help|More|LIFESTORMING|BRAINSTORM|YOUR LIFE|STEP \d+:|GO|VIEW|ADD TO GOALS/i.test(line)).slice(0, 20);
            const extractSectionItems = (headingPattern, stopPattern) => {
                const start = lines.findIndex((line) => headingPattern.test(line));
                if (start === -1)
                    return [];
                const items = [];
                for (let i = start + 1; i < lines.length; i += 1) {
                    const line = lines[i];
                    if (stopPattern.test(line))
                        break;
                    if (/^GO$|^VIEW$|^ADD TO GOALS$|^BEGIN$|^No desires to practice yet\.?$|^No desires selected for final selection yet\.?$/i.test(line) ||
                        /Now that you have a list of DESIRES|How would it feel\?|Spend a few minutes on your DESIRES|Or, you can delete it|Now you know how you feel!/i.test(line)) {
                        continue;
                    }
                    if (line.length > 1 &&
                        !/^STEP\s+\d+/i.test(line) &&
                        !/^LIFESTORMING$|^BRAINSTORM$|^YOUR LIFE$/i.test(line)) {
                        items.push(line);
                    }
                }
                return [...new Set(items)];
            };
            const feelItOut = extractSectionItems(/^STEP 2:\s*FEEL IT OUT$/i, /^STEP 3:\s*START A GOAL$/i);
            const startGoal = extractSectionItems(/^STEP 3:\s*START A GOAL$/i, /^Self-Max is an AI-driven/i);
            return {
                stepTexts,
                visibleDesires,
                desiresBySection: [
                    { section: "feel_it_out", items: feelItOut },
                    { section: "start_a_goal", items: startGoal }
                ],
                snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 800)
            };
        });
        for (const section of result.desiresBySection) {
            for (const title of section.items) {
                const existingId = this.findDesireIdByTitle(title);
                if (existingId) {
                    this.cacheDesire({ desireId: existingId, title });
                }
            }
        }
        return { url: page.url(), ...result };
    }
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
    }
    async readLifestormingCategory(category) {
        const page = this.pageOrThrow();
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        const targetUrl = `${base}/lifestorming/desires-selection/${(category ? category : "category").toLowerCase()}`;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await this.waitForPageTextNotContaining("Loading Desires...", 12000);
        if (category) {
            await this.waitForDesiresCategory(category);
        }
        const result = await page.evaluate(() => {
            const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const categories = ["HEALTH", "WORK", "LOVE", "FAMILY", "SOCIAL", "FUN", "DREAMS", "MEANING"];
            const anchors = Array.from(document.querySelectorAll('a[href*="/lifestorming/sensation-practice/"]')).map((el) => {
                const href = el.href || "";
                const match = href.match(/\/lifestorming\/sensation-practice\/([A-Za-z0-9_-]+)/i);
                return { text: (el.textContent || "").trim(), desireId: match?.[1] };
            });
            const pathMatch = location.pathname.match(/\/lifestorming\/desires-selection\/([^/?#]+)/i);
            const selectedFromPath = (pathMatch?.[1] || "").toUpperCase();
            const visibleCategories = lines.filter((line) => categories.includes(line.toUpperCase()) && line === line.toUpperCase());
            const selected = categories.includes(selectedFromPath)
                ? selectedFromPath
                : visibleCategories[visibleCategories.length - 1] || "";
            const idx = selected ? lines.findIndex((line) => line === selected) : -1;
            const intro = idx !== -1 ? lines.slice(idx + 1, idx + 4).join(" ") : "";
            const items = [];
            if (idx !== -1) {
                for (let i = idx + 1; i < lines.length; i += 1) {
                    const line = lines[i];
                    if (categories.includes(line.toUpperCase()) && i !== idx)
                        break;
                    if (/Add an item|^Add$|NEXT STEP|Spend a few minutes|Think of something|Click on a category|No items in this bucket yet/i.test(line)) {
                        continue;
                    }
                    if (line.length > 1 && !/^[A-Z ]+$/.test(line)) {
                        const linked = anchors.find((anchor) => anchor.text === line);
                        items.push({ title: line, desireId: linked?.desireId });
                    }
                }
            }
            const dedup = new Map();
            for (const item of items) {
                if (!dedup.has(item.title))
                    dedup.set(item.title, item);
            }
            return {
                category: selected || undefined,
                intro: intro || undefined,
                items: [...dedup.values()],
                snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)
            };
        });
        const normalizedCategory = result.category ? this.titleCase(result.category) : undefined;
        for (const item of result.items) {
            if (item.desireId) {
                this.cacheDesire({ desireId: item.desireId, title: item.title, category: normalizedCategory });
            }
        }
        return {
            url: page.url(),
            category: result.category,
            intro: result.intro,
            items: result.items.map((item) => item.title),
            snippet: result.snippet
        };
    }
    async readLifestormingFull() {
        const overview = await this.readLifestormingOverview();
        const desires = await this.listLifestormingDesires();
        const categories = [];
        for (const category of ["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"]) {
            categories.push(await this.readLifestormingCategory(category));
        }
        return {
            overview,
            buckets: desires.buckets,
            categories,
            cachedDesires: Object.values(this.entityCache.desiresById).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        };
    }
    async readSensationPractice(desireId, desireTitle) {
        const page = this.pageOrThrow();
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        if (!desireId && desireTitle) {
            desireId = this.findDesireIdByTitle(desireTitle);
        }
        if (desireId) {
            await page.goto(`${base}/lifestorming/sensation-practice/${encodeURIComponent(desireId)}`, { waitUntil: "domcontentloaded" });
        }
        else if (desireTitle) {
            await page.goto(`${base}/lifestorming`, { waitUntil: "domcontentloaded" });
            await this.openDesireForViewing(desireTitle);
            desireId = this.extractRouteParams(page.url()).desireId;
        }
        else {
            throw new Error("read_sensation_practice requires desireId or desireTitle");
        }
        await this.waitForPageTextNotContaining("Loading...", 8000);
        const result = await page.evaluate(() => {
            const lines = (document.body.innerText || "").split(/\n+/).map((v) => v.trim()).filter(Boolean);
            const categories = ["HEALTH", "WORK", "LOVE", "FAMILY", "SOCIAL", "FUN", "DREAMS", "MEANING"];
            const title = lines.find((line) => !categories.includes(line.toUpperCase()) &&
                !/Self-Max Logo|SELF-IMPROVE|GET TO WORK ON A GOAL|SELF-AWARENESS|LEARN ABOUT YOURSELF AND GET BETTER GUIDANCE|COMMUNITY|JOIN OTHER SELF-MAXERS|\(AND HM\) ON DISCORD|Help|More|SAVE|EXIT|DELETE DESIRE|Loading/i.test(line)) || "";
            const category = lines.find((line) => categories.includes(line.toUpperCase())) || "";
            const promptStart = lines.findIndex((line) => /Take a few minutes to think about adding this DESIRE/i.test(line));
            const prompts = [];
            if (promptStart !== -1) {
                for (let i = promptStart; i < lines.length; i += 1) {
                    const line = lines[i];
                    if (/^(SAVE|EXIT|DELETE DESIRE)$/i.test(line))
                        break;
                    if (line.length > 0)
                        prompts.push(line);
                }
            }
            const actions = lines.filter((line) => /^(SAVE|EXIT|DELETE DESIRE)$/i.test(line));
            return {
                title,
                category,
                prompts,
                actions,
                snippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1000)
            };
        });
        const resolvedDesireId = desireId ?? this.extractRouteParams(page.url()).desireId;
        if (resolvedDesireId && result.title && !/Desire not found\.?/i.test(result.title)) {
            this.cacheDesire({
                desireId: resolvedDesireId,
                title: desireTitle ?? result.title,
                category: result.category
            });
        }
        return {
            desireId: resolvedDesireId,
            desireTitle: desireTitle ?? (result.title || undefined),
            category: result.category || undefined,
            url: page.url(),
            prompts: result.prompts,
            actions: result.actions,
            snippet: result.snippet
        };
    }
    async startGoal(goalTitle, goalId) {
        if (await this.isGoalContextOpen(goalTitle)) {
            return { started: true, goalTitle, goalId };
        }
        const page = this.pageOrThrow();
        if (goalId) {
            await this.openGoalContextById(goalId);
            if (await this.waitForGoalContext(goalTitle, 6000)) {
                return { started: true, goalTitle, goalId };
            }
            throw new Error(`could not open goal context for goalId: ${goalId}`);
        }
        await this.ensureOnGoals();
        if (!goalTitle) {
            const discoveredIds = await this.listGoalIdsFromPage();
            if (discoveredIds.length > 0) {
                await this.openGoalContextById(discoveredIds[0]);
                if (await this.waitForGoalContext(undefined, 6000)) {
                    return { started: true, goalId: discoveredIds[0] };
                }
            }
            const streamIds = (await this.discoverGoalIds()).goalIds;
            if (streamIds.length > 0) {
                await this.openGoalContextById(streamIds[0]);
                if (await this.waitForGoalContext(undefined, 6000)) {
                    return { started: true, goalId: streamIds[0] };
                }
            }
            let clicked = (await this.tryOpenAnyGoalByLink()) ||
                (await this.tryClickStartInGoalsList()) ||
                (await this.tryClickByText(page, ["START", "Start", "Open", "View"]));
            if (!clicked) {
                await this.tryClickByText(page, ["All"]);
                await this.tryClickByText(page, ["All"]);
                clicked =
                    (await this.tryOpenAnyGoalByLink()) ||
                        (await this.tryClickStartInGoalsList()) ||
                        (await this.tryClickByText(page, ["START", "Start", "Open", "View"]));
            }
            if (!clicked) {
                throw new Error("could not locate any start action");
            }
            const opened = await this.waitForGoalContext(undefined, 6000);
            if (!opened) {
                throw new Error("start action did not open goal context");
            }
            return { started: true, goalId: this.goalIdFromUrl(this.pageOrThrow().url()) };
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const clicked = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
            if (!clicked) {
                await this.tryClickByText(page, ["All"]);
                const clickedAfterReset = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
                if (!clickedAfterReset) {
                    await this.tryOpenAnyGoalByLink();
                }
            }
            if (await this.waitForGoalContext(goalTitle, 4000)) {
                return { started: true, goalTitle, goalId: this.goalIdFromUrl(this.pageOrThrow().url()) };
            }
            const byIds = await this.listGoalIdsFromPage();
            for (const id of byIds) {
                await this.openGoalContextById(id);
                if (await this.waitForGoalContext(goalTitle, 2500)) {
                    return { started: true, goalTitle, goalId: id };
                }
            }
            await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        }
        throw new Error(`could not execute goal action START/Start/Open/View for goal: ${goalTitle}`);
    }
    async addTasks(goalTitle, goalId, tasks, useSuggestions) {
        const summary = await this.getGoalTaskSummary(goalTitle, goalId);
        if (summary?.taskPanelState === "empty") {
            throw new Error(`add_tasks refused: goal has no task entry point from /goals summary (${summary.title})`);
        }
        await this.ensureOnGoalTaskContext(goalTitle, goalId);
        const page = this.pageOrThrow();
        if (useSuggestions) {
            await this.clickByText(page, ["Use the task suggestion tool", "Select Tasks"]);
            for (const task of tasks) {
                await this.tryClickByText(page, [task]);
            }
            await this.tryClickByText(page, ["Set Tasks", "Add", "Save"]);
            return { added: tasks.length, goalTitle, usedSuggestions: true };
        }
        let added = 0;
        if (summary?.taskPanelState === "add_tasks") {
            await this.tryClickByText(page, ["ADD TASKS", "Add Tasks", "Use the task suggestion tool"]);
        }
        for (const task of tasks.filter((t) => t.trim().length > 0)) {
            await this.tryClickByText(page, ["Add new task", "Add task", "New task"]);
            const field = await this.resolveTaskInput();
            await field.fill(task);
            await field.press("Enter");
            added += 1;
        }
        return { added, goalTitle, usedSuggestions: false };
    }
    async removeTask(goalTitle, goalId, taskText) {
        if (!taskText.trim()) {
            throw new Error("remove_task requires taskText");
        }
        const summary = await this.getGoalTaskSummary(goalTitle, goalId);
        if (summary?.taskPanelState !== "tasks_present") {
            throw new Error(`remove_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
        }
        await this.ensureOnGoalTaskContext(goalTitle, goalId);
        const row = await this.resolveTaskRow(taskText);
        const removed = (await this.tryClickByText(this.pageOrThrow(), ["Delete", "Remove", "Trash"], row)) ||
            (await this.tryClickByText(this.pageOrThrow(), ["×"], row));
        if (!removed) {
            throw new Error(`could not remove task: ${taskText}`);
        }
        return { removed: true };
    }
    async completeTask(goalTitle, goalId, taskText) {
        if (!taskText.trim()) {
            throw new Error("complete_task requires taskText");
        }
        const summary = await this.getGoalTaskSummary(goalTitle, goalId);
        if (summary?.taskPanelState !== "tasks_present") {
            throw new Error(`complete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
        }
        await this.ensureOnGoalTaskContext(goalTitle, goalId);
        const row = await this.resolveTaskRow(taskText);
        const checkbox = row.locator('input[type="checkbox"]').first();
        if ((await checkbox.count()) > 0) {
            if (!(await checkbox.isChecked())) {
                await checkbox.click();
            }
            return { completed: true };
        }
        const toggled = await this.tryClickByText(this.pageOrThrow(), ["Complete", "Mark complete", "Done"], row);
        if (!toggled) {
            throw new Error(`could not complete task: ${taskText}`);
        }
        return { completed: true };
    }
    async uncompleteTask(goalTitle, goalId, taskText) {
        if (!taskText.trim()) {
            throw new Error("uncomplete_task requires taskText");
        }
        const summary = await this.getGoalTaskSummary(goalTitle, goalId);
        if (summary?.taskPanelState !== "tasks_present") {
            throw new Error(`uncomplete_task refused: goal does not expose existing tasks from /goals summary (${summary?.title ?? goalTitle ?? "unknown"})`);
        }
        await this.ensureOnGoalTaskContext(goalTitle, goalId);
        const row = await this.resolveTaskRow(taskText);
        const checkbox = row.locator('input[type="checkbox"]').first();
        if ((await checkbox.count()) > 0) {
            if (await checkbox.isChecked()) {
                await checkbox.click();
            }
            return { uncompleted: true };
        }
        const toggled = await this.tryClickByText(this.pageOrThrow(), ["Uncomplete", "Reopen", "Undo"], row);
        if (!toggled) {
            throw new Error(`could not uncomplete task: ${taskText}`);
        }
        return { uncompleted: true };
    }
    async completeGoal(goalTitle, goalId) {
        await this.ensureOnGoals();
        if (goalId) {
            await this.openGoalContextById(goalId);
        }
        else if (goalTitle) {
            const clicked = await this.tryClickGoalCardAction(goalTitle, ["COMPLETE", "Complete", "Mark Complete"]);
            if (clicked) {
                return { completed: true, goalTitle, goalId };
            }
            await this.openGoalContext(goalTitle);
        }
        const page = this.pageOrThrow();
        await this.tryClickByText(page, ["EDIT", "Edit"]);
        const done = await this.tryClickByText(page, ["COMPLETE", "Complete", "Mark Complete"]);
        if (!done) {
            throw new Error("could not complete goal");
        }
        return { completed: true, goalTitle, goalId: goalId ?? this.goalIdFromUrl(this.pageOrThrow().url()) };
    }
    async archiveGoal(goalTitle, goalId) {
        await this.ensureOnGoals();
        if (goalId) {
            await this.openGoalContextById(goalId);
        }
        else if (goalTitle) {
            const clicked = await this.tryClickGoalCardAction(goalTitle, ["ARCHIVE", "Archive"]);
            if (clicked) {
                return { archived: true, goalTitle, goalId };
            }
            await this.openGoalContext(goalTitle);
        }
        const page = this.pageOrThrow();
        await this.tryClickByText(page, ["EDIT", "Edit"]);
        const done = await this.tryClickByText(page, ["ARCHIVE", "Archive"]);
        if (!done) {
            throw new Error("could not archive goal");
        }
        return { archived: true, goalTitle, goalId: goalId ?? this.goalIdFromUrl(this.pageOrThrow().url()) };
    }
    async deleteGoal(goalTitle, goalId) {
        await this.ensureOnGoals();
        const page = this.pageOrThrow();
        if (goalId) {
            await this.openGoalContextById(goalId);
        }
        else if (goalTitle) {
            const clicked = await this.tryClickGoalCardAction(goalTitle, ["DELETE", "Delete", "Remove"]);
            if (clicked) {
                await this.tryClickByText(page, ["Delete", "Confirm", "Yes", "YES"]);
                return { deleted: true, goalTitle, goalId };
            }
            await this.openGoalContext(goalTitle);
        }
        else if (!page.url().includes("/self-maximize")) {
            await this.startGoal();
        }
        await this.tryClickByText(page, ["EDIT", "Edit"]);
        const deleted = await this.tryClickByText(page, ["DELETE GOAL", "Delete Goal", "DELETE", "Delete", "Remove"]);
        if (!deleted) {
            throw new Error("could not locate delete action for goal");
        }
        await this.tryClickByText(page, ["Delete", "Confirm", "Yes", "YES"]);
        return { deleted: true, goalTitle, goalId: goalId ?? this.goalIdFromUrl(page.url()) };
    }
    async deleteGoalApi(goalId) {
        if (!goalId) {
            throw new Error("delete_goal_api requires payload.goalId");
        }
        const page = this.pageOrThrow();
        await this.ensureOnGoals();
        const result = await page.evaluate(async ({ id }) => {
            const global = window;
            // Best effort path: firebase SDK exposed globally by host app.
            const firebase = global.firebase;
            if (firebase?.firestore) {
                await firebase.firestore().collection("goals").doc(id).delete();
                return { ok: true, method: "firebase.firestore" };
            }
            return { ok: false, method: "unavailable" };
        }, { id: goalId });
        if (!result.ok) {
            throw new Error("delete_goal_api unavailable: firebase sdk is not exposed in this app context");
        }
        return { deleted: true, goalId, method: result.method };
    }
    async navigate(route) {
        const page = this.ensurePage();
        const url = knownRoutes[route];
        if (!url) {
            throw new Error(`unknown route: ${route}`);
        }
        await page.goto(url, { waitUntil: "domcontentloaded" });
        return { route, url: page.url() };
    }
    async navigateForRead(route, explicitUrl) {
        const page = this.pageOrThrow();
        if (explicitUrl) {
            await page.goto(explicitUrl, { waitUntil: "domcontentloaded" });
            return;
        }
        if (route && route in knownRoutes) {
            await this.navigate(route);
            return;
        }
        if (route) {
            const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
            const path = route.startsWith("/") ? route : `/${route}`;
            await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
        }
    }
    async listKnownActions(route) {
        if (!route) {
            return [...knownActions];
        }
        return knownActions.filter((action) => action.route === route);
    }
    matchKnownRoute(url) {
        try {
            const parsed = new URL(url);
            const normalized = `${parsed.origin}${parsed.pathname}${parsed.search}`;
            const entries = Object.entries(knownRoutes);
            for (const [routeId, routeUrl] of entries) {
                if (normalized === routeUrl) {
                    return routeId;
                }
            }
            if (parsed.pathname === "/auth") {
                if (parsed.searchParams.get("mode") === "sign-in" && parsed.searchParams.get("v") === "b") {
                    return "signin";
                }
                if (parsed.searchParams.get("mode") === "sign-up" && parsed.searchParams.get("v") === "b") {
                    return "signup";
                }
                if (parsed.searchParams.get("mode") === "sign-up") {
                    return "auth_signup_alt";
                }
                return "auth";
            }
            if (parsed.pathname === "/goals")
                return "goals";
            if (parsed.pathname === "/home")
                return "home_legacy";
            if (parsed.pathname === "/lifestorming")
                return "lifestorming";
            if (parsed.pathname.startsWith("/lifestorming/desires-selection"))
                return "lifestorming_desires_selection";
        }
        catch {
            return undefined;
        }
        return undefined;
    }
    extractRouteParams(url) {
        try {
            const parsed = new URL(url);
            const params = {};
            for (const [key, value] of parsed.searchParams.entries()) {
                params[key] = value;
            }
            const desirePracticeMatch = parsed.pathname.match(/\/lifestorming\/sensation-practice\/([^/?#]+)/i);
            if (desirePracticeMatch?.[1]) {
                params.desireId = desirePracticeMatch[1];
            }
            const desiresSelectionMatch = parsed.pathname.match(/\/lifestorming\/desires-selection\/([^/?#]+)/i);
            if (desiresSelectionMatch?.[1] && desiresSelectionMatch[1] !== "category") {
                params.category = desiresSelectionMatch[1];
            }
            return params;
        }
        catch {
            return {};
        }
    }
    async invokeKnownAction(payload) {
        const page = this.ensurePage();
        const actionId = payload.actionId;
        if (!actionId) {
            throw new Error("payload.actionId is required");
        }
        const action = actionById.get(actionId);
        if (!action) {
            throw new Error(`unknown actionId: ${actionId}`);
        }
        const message = payload.message;
        if (typeof message === "string" && action.id === "goals.send_guide_message") {
            const input = await this.resolveChatInput();
            await input.fill(message);
        }
        await page.click(action.selector);
        return { invoked: action.id };
    }
    pageOrThrow() {
        return this.ensurePage();
    }
    async ensureOnGoals() {
        const page = this.pageOrThrow();
        if (page.url().includes("/goals") && (await this.isGoalsWorkspaceVisible())) {
            return;
        }
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" });
        await this.ensureGoalsWorkspaceVisible();
    }
    async ensureOnGoalTaskContext(goalTitle, goalId) {
        if (goalId) {
            await this.openGoalContextById(goalId);
            await this.waitForGoalDataLoaded();
        }
        else if (goalTitle) {
            await this.openGoalContext(goalTitle);
        }
        else if (!this.pageOrThrow().url().includes("/self-maximize")) {
            await this.startGoal();
        }
        await this.openTaskPanel();
        await this.ensureTaskPanelVisible();
    }
    async openTaskPanel() {
        const page = this.pageOrThrow();
        const tabByRole = page.getByRole("button", { name: /^tasks$/i }).first();
        const attempts = [
            async () => {
                if ((await tabByRole.count()) > 0 && (await tabByRole.isVisible().catch(() => false))) {
                    await tabByRole.click({ timeout: 2000 }).catch(() => undefined);
                }
            },
            async () => {
                await this.tryClickByText(page, ["TASKS", "Tasks"]);
            },
            async () => {
                await this.tryClickByText(page, ["EDIT", "Edit"]);
                if ((await tabByRole.count()) > 0 && (await tabByRole.isVisible().catch(() => false))) {
                    await tabByRole.click({ timeout: 2000 }).catch(() => undefined);
                }
                else {
                    await this.tryClickByText(page, ["TASKS", "Tasks"]);
                }
            }
        ];
        for (const attempt of attempts) {
            await attempt();
            if (await this.waitForTaskPanelData(2500)) {
                return;
            }
        }
    }
    async openGoalContext(goalTitle) {
        await this.ensureOnGoals();
        const page = this.pageOrThrow();
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const clicked = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
            if (!clicked) {
                await this.tryClickByText(page, ["All"]);
                const clickedAfterReset = await this.tryClickGoalCardAction(goalTitle, ["START", "Start", "Open", "View"]);
                if (!clickedAfterReset) {
                    await this.tryOpenAnyGoalByLink();
                }
            }
            if (await this.waitForGoalContext(goalTitle, 4000)) {
                return;
            }
            await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/goals`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        }
        throw new Error(`could not open goal context for: ${goalTitle}`);
    }
    async openGoalForRead(goalTitle, goalId) {
        if (goalId) {
            await this.openGoalContextById(goalId);
            if (!(await this.waitForGoalContext(goalTitle, 6000))) {
                throw new Error(`could not open goal context by goalId for read: ${goalId}`);
            }
            await this.waitForGoalDataLoaded();
            return;
        }
        if (goalTitle) {
            await this.openGoalContext(goalTitle);
            await this.waitForGoalDataLoaded();
            return;
        }
        if (await this.isGoalContextOpen()) {
            await this.waitForGoalDataLoaded();
            return;
        }
        await this.startGoal();
        await this.waitForGoalDataLoaded();
    }
    async isGoalWorkspaceVisible() {
        const page = this.pageOrThrow();
        if (!/\/self-maximize(\?|$)/.test(page.url()))
            return false;
        const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        return /Current Goal|GOAL STATUS|Type your message|⌘ \+ Enter to send/i.test(bodyText);
    }
    async readBodySnippet() {
        const page = this.pageOrThrow();
        return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    }
    async waitForGoalDataLoaded(timeoutMs = 8000) {
        const page = this.pageOrThrow();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
            if (!/Loading\.\.\.|Loading Goal/i.test(text) && /Current Goal|GOAL STATUS|Type your message|⌘ \+ Enter to send/i.test(text)) {
                return;
            }
            await page.waitForTimeout(250);
        }
    }
    async waitForPageTextNotContaining(needle, timeoutMs = 8000) {
        const page = this.pageOrThrow();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
            if (!text.includes(needle)) {
                return;
            }
            await page.waitForTimeout(250);
        }
    }
    async waitForDesiresCategory(category, timeoutMs = 8000) {
        const page = this.pageOrThrow();
        const expected = category.trim().toUpperCase();
        const expectedPath = `/lifestorming/desires-selection/${category.trim().toLowerCase()}`;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const lines = (await page.locator("body").innerText().catch(() => ""))
                .split(/\n+/)
                .map((line) => line.trim())
                .filter(Boolean);
            const bodyText = lines.join(" ");
            if (!/Loading Desires/i.test(bodyText) && (page.url().includes(expectedPath) || lines.includes(expected))) {
                return;
            }
            await page.waitForTimeout(250);
        }
    }
    async waitForTaskPanelData(timeoutMs = 5000) {
        const page = this.pageOrThrow();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isTaskPanelVisible()) {
                return true;
            }
            const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
            if (/How will you accomplish|Select Tasks|Add new task|Use the task suggestion tool/i.test(bodyText)) {
                return true;
            }
            await page.waitForTimeout(250);
        }
        return false;
    }
    async isGoalContextOpen(goalTitle) {
        const page = this.pageOrThrow();
        if (page.url().includes("/self-maximize")) {
            return true;
        }
        const currentGoal = page.getByText(/Current Goal/i).first();
        if ((await currentGoal.count()) === 0) {
            return false;
        }
        if (!goalTitle) {
            return true;
        }
        const goalText = page.getByText(goalTitle, { exact: false }).first();
        return (await goalText.count()) > 0;
    }
    async openDesireForViewing(desire) {
        const page = this.pageOrThrow();
        const row = await this.resolveRowByText(desire);
        if (!row) {
            throw new Error(`could not locate desire row: ${desire}`);
        }
        const viewed = (await this.tryClickByText(page, ["VIEW", "GO", "Open"], row)) ||
            (await this.tryClickByText(page, [desire]));
        if (!viewed) {
            throw new Error(`could not open desire for feel-out: ${desire}`);
        }
    }
    async tryPromoteDesireToGoal(desireTitle) {
        const page = this.pageOrThrow();
        await page.goto(`${config.SELFMAX_BASE_URL.replace(/\/$/, "")}/lifestorming`, { waitUntil: "domcontentloaded" });
        const row = await this.resolveRowByText(desireTitle, false);
        if (!row) {
            return false;
        }
        const promoted = await this.tryClickByText(page, ["ADD TO GOALS", "Add to goals"], row);
        if (!promoted) {
            return false;
        }
        return true;
    }
    async resolveChatInput() {
        const page = this.pageOrThrow();
        const byPlaceholder = page.getByPlaceholder("Type your message...").first();
        if ((await byPlaceholder.count()) > 0) {
            return byPlaceholder;
        }
        const byTextboxRoleNamed = page.getByRole("textbox", { name: /message|guide|chat/i }).first();
        if ((await byTextboxRoleNamed.count()) > 0) {
            return byTextboxRoleNamed;
        }
        const byAnyTextboxRole = page.getByRole("textbox").first();
        if ((await byAnyTextboxRole.count()) > 0) {
            return byAnyTextboxRole;
        }
        const byConfiguredSelector = page.locator(config.COACH_INPUT_SELECTOR).first();
        if ((await byConfiguredSelector.count()) > 0) {
            return byConfiguredSelector;
        }
        const byContentEditable = page.locator('[contenteditable=\"true\"]').first();
        if ((await byContentEditable.count()) > 0) {
            return byContentEditable;
        }
        const generic = page.locator("textarea, input[type='text'], input:not([type])").first();
        if ((await generic.count()) > 0) {
            return generic;
        }
        throw new Error("could not locate chat input");
    }
    async fillFirstAvailable(page, selectors, value) {
        const input = await this.resolveFirstVisible(page, selectors);
        await input.fill(value);
    }
    async resolveFirstVisible(page, selectors) {
        for (const selector of selectors) {
            const input = page.locator(selector).first();
            if ((await input.count()) === 0) {
                continue;
            }
            if (!(await input.isVisible().catch(() => false))) {
                continue;
            }
            return input;
        }
        throw new Error(`could not locate any input for selectors: ${selectors.join(", ")}`);
    }
    async resolveDesireInput() {
        const page = this.pageOrThrow();
        const byPlaceholder = page.getByPlaceholder("Add an item").first();
        if ((await byPlaceholder.count()) > 0) {
            return byPlaceholder;
        }
        const generic = page.locator("input[type='text'], input:not([type]), textarea").first();
        if ((await generic.count()) > 0) {
            return generic;
        }
        throw new Error("could not locate desire input");
    }
    async resolveGoalTitleInput(scope) {
        const page = this.pageOrThrow();
        const root = scope ?? page;
        const byPlaceholder = root.locator('textarea[placeholder*="E.g." i], textarea[placeholder*="goal" i]').first();
        if ((await byPlaceholder.count()) > 0) {
            return byPlaceholder;
        }
        const textareas = root.locator("textarea");
        const textareasCount = await textareas.count();
        for (let i = 0; i < textareasCount; i += 1) {
            const field = textareas.nth(i);
            const placeholder = ((await field.getAttribute("placeholder")) ?? "").toLowerCase();
            if (placeholder.includes("type your message")) {
                continue;
            }
            return field;
        }
        const titleField = root.locator('input[type="text"], input:not([type])').first();
        if ((await titleField.count()) > 0) {
            return titleField;
        }
        const anyField = root.locator("textarea, input").first();
        if ((await anyField.count()) > 0) {
            return anyField;
        }
        throw new Error("could not locate create-goal title input");
    }
    async resolveCreateGoalPanel() {
        const page = this.pageOrThrow();
        const heading = page.getByText(/Create a New Goal/i).first();
        if ((await heading.count()) === 0) {
            return null;
        }
        const panel = heading.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
        if ((await panel.count()) === 0) {
            return null;
        }
        return panel;
    }
    async selectCreateGoalCategory(category) {
        const page = this.pageOrThrow();
        const prompt = page.getByText(/Choose a category for your goal/i).first();
        const variants = [this.titleCase(category), category.toUpperCase(), category.toLowerCase()];
        if ((await prompt.count()) > 0) {
            const container = prompt.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
            const clicked = await this.tryClickByText(container, variants);
            if (clicked) {
                return true;
            }
        }
        return this.tryClickByText(page, variants);
    }
    async readGoalCount(label) {
        const page = this.pageOrThrow();
        const node = page.getByText(new RegExp(`^${label}\\s*\\((\\d+)\\)$`, "i")).first();
        if ((await node.count()) === 0) {
            return null;
        }
        const text = ((await node.textContent()) || "").trim();
        const match = text.match(/\((\d+)\)/);
        if (!match) {
            return null;
        }
        return Number(match[1]);
    }
    async resolveTaskInput() {
        const taskPanel = await this.resolveTaskPanel();
        if (!taskPanel) {
            throw new Error("could not locate goal task panel");
        }
        const byPlaceholder = taskPanel
            .locator('input[placeholder*=\"Add\" i], textarea[placeholder*=\"Add\" i], input[placeholder*=\"task\" i], textarea[placeholder*=\"task\" i]')
            .first();
        if ((await byPlaceholder.count()) > 0 && (await byPlaceholder.isVisible().catch(() => false))) {
            return byPlaceholder;
        }
        const byTextboxRole = taskPanel.getByRole("textbox").first();
        if ((await byTextboxRole.count()) > 0 && (await byTextboxRole.isVisible().catch(() => false))) {
            const placeholder = ((await byTextboxRole.getAttribute("placeholder")) ?? "").toLowerCase();
            if (!placeholder.toLowerCase().includes("type your message")) {
                return byTextboxRole;
            }
        }
        const byContentEditable = taskPanel.locator('[contenteditable=\"true\"]').first();
        if ((await byContentEditable.count()) > 0 && (await byContentEditable.isVisible().catch(() => false))) {
            return byContentEditable;
        }
        const candidates = taskPanel.locator("textarea, input[type='text'], input:not([type])");
        const count = await candidates.count();
        for (let i = 0; i < count; i += 1) {
            const field = candidates.nth(i);
            const placeholder = (await field.getAttribute("placeholder")) ?? "";
            if (placeholder.toLowerCase().includes("type your message")) {
                continue;
            }
            return field;
        }
        throw new Error("could not locate task input");
    }
    async ensureTaskPanelVisible() {
        const panel = await this.resolveTaskPanel();
        if (panel && (await panel.count()) > 0) {
            return;
        }
        const page = this.pageOrThrow();
        const snippet = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
        throw new Error(`could not locate goal task panel (url=${page.url()} snippet=${snippet})`);
    }
    async isTaskPanelVisible() {
        const panel = await this.resolveTaskPanel();
        return Boolean(panel && (await panel.count()) > 0);
    }
    async waitForGoalContext(goalTitle, timeoutMs = 8000) {
        const page = this.pageOrThrow();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isGoalContextOpen(goalTitle)) {
                return true;
            }
            await page.waitForTimeout(250);
        }
        return false;
    }
    async resolveTaskPanel() {
        const page = this.pageOrThrow();
        const candidates = [
            page.getByText(/How will you accomplish/i).first(),
            page.getByText(/Select Tasks/i).first(),
            page.getByText(/Add new task/i).first(),
            page.getByText(/Use the task suggestion tool/i).first()
        ];
        for (const anchor of candidates) {
            if ((await anchor.count()) === 0) {
                continue;
            }
            const panel = anchor.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
            if ((await panel.count()) > 0) {
                return panel;
            }
        }
        return null;
    }
    async resolveTaskRow(taskText) {
        const row = await this.resolveRowByText(taskText);
        if (!row) {
            throw new Error(`could not locate task row: ${taskText}`);
        }
        return row;
    }
    async resolveRowByText(text, required = true) {
        const page = this.pageOrThrow();
        const node = page.getByText(text, { exact: false }).first();
        if ((await node.count()) === 0) {
            if (!required) {
                return null;
            }
            throw new Error(`could not locate text: ${text}`);
        }
        return node.locator("xpath=ancestor::*[self::div or self::li or self::article or self::section][1]");
    }
    async clickGoalCardAction(goalTitle, actionTexts) {
        const ok = await this.tryClickGoalCardAction(goalTitle, actionTexts);
        if (!ok) {
            throw new Error(`could not execute goal action ${actionTexts.join("/")} for goal: ${goalTitle}`);
        }
    }
    async tryClickStartInGoalsList() {
        const page = this.pageOrThrow();
        const yourGoals = page.getByText(/YOUR GOALS/i).first();
        if ((await yourGoals.count()) === 0) {
            return false;
        }
        const scope = yourGoals.locator("xpath=ancestor::*[self::section or self::article or self::div][1]");
        const startButton = scope.getByRole("button", { name: /^start$/i }).first();
        if ((await startButton.count()) > 0 && (await startButton.isVisible().catch(() => false))) {
            await startButton.scrollIntoViewIfNeeded().catch(() => undefined);
            await startButton.click({ timeout: 1500 }).catch(() => undefined);
            return true;
        }
        return this.tryClickByText(page, ["START"], scope);
    }
    async tryOpenAnyGoalByLink() {
        const page = this.pageOrThrow();
        const goalIds = await this.listGoalIdsFromPage();
        if (goalIds.length > 0) {
            await this.openGoalContextById(goalIds[0]);
            return true;
        }
        const href = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll("a[href]"))
                .map((el) => el.getAttribute("href") || "")
                .filter((value) => /self-maximize\?goalId=|goalId=/.test(value));
            return links[0] || null;
        });
        if (!href) {
            return false;
        }
        const absolute = new URL(href, page.url()).toString();
        await page.goto(absolute, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        return true;
    }
    async openGoalContextById(goalId) {
        const page = this.pageOrThrow();
        const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
        await page.goto(`${base}/self-maximize?goalId=${encodeURIComponent(goalId)}`, { waitUntil: "domcontentloaded" });
    }
    async listGoalIdsFromPage() {
        const page = this.pageOrThrow();
        const ids = await page.evaluate(() => {
            const found = new Set();
            const fromHref = (href) => {
                if (!href)
                    return;
                const match = href.match(/goalId=([A-Za-z0-9_-]+)/i);
                if (match?.[1])
                    found.add(match[1]);
            };
            for (const el of Array.from(document.querySelectorAll("a[href]"))) {
                fromHref(el.getAttribute("href"));
            }
            for (const el of Array.from(document.querySelectorAll("[data-goal-id], [data-goalid], [goalid]"))) {
                const value = el.getAttribute("data-goal-id") ?? el.getAttribute("data-goalid") ?? el.getAttribute("goalid") ?? "";
                if (/^[A-Za-z0-9_-]{8,}$/.test(value)) {
                    found.add(value);
                }
            }
            const html = document.documentElement.innerHTML;
            for (const match of html.matchAll(/goalId=([A-Za-z0-9_-]+)/gi)) {
                if (match[1])
                    found.add(match[1]);
            }
            return [...found];
        });
        return ids;
    }
    goalIdFromUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.searchParams.get("goalId") ?? undefined;
        }
        catch {
            return undefined;
        }
    }
    async tryClickGoalCardAction(goalTitle, actionTexts) {
        const page = this.pageOrThrow();
        const title = page.getByText(goalTitle, { exact: false }).first();
        if ((await title.count()) === 0) {
            return false;
        }
        const card = title.locator("xpath=ancestor::*[self::article or self::section or self::div][.//button or .//*[@role='button']][1]");
        return this.tryClickByText(page, actionTexts, card);
    }
    async clickByText(root, texts, scope) {
        const clicked = await this.tryClickByText(root, texts, scope);
        if (!clicked) {
            throw new Error(`could not click any of: ${texts.join(", ")}`);
        }
    }
    async tryClickByCss(root, selectors, scope) {
        const searchRoot = scope ?? root;
        for (const selector of selectors) {
            const node = searchRoot.locator(selector).first();
            if ((await node.count()) === 0) {
                continue;
            }
            if (!(await node.isVisible().catch(() => false))) {
                continue;
            }
            try {
                await node.scrollIntoViewIfNeeded().catch(() => undefined);
                await node.click({ timeout: 1500 });
                return true;
            }
            catch {
                continue;
            }
        }
        return false;
    }
    async ensureGoalsWorkspaceVisible() {
        const page = this.pageOrThrow();
        const ok = await this.waitForGoalsWorkspaceVisible();
        if (!ok) {
            const snippet = (await page.locator("body").innerText().catch(() => ""))
                .replace(/\s+/g, " ")
                .slice(0, 500);
            throw new Error(`login did not reach goals workspace (url=${page.url()} snippet=${snippet})`);
        }
    }
    async waitForGoalsWorkspaceVisible(timeoutMs = 15000) {
        const page = this.pageOrThrow();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isGoalsWorkspaceVisible()) {
                return true;
            }
            await page.waitForTimeout(500);
        }
        return false;
    }
    async isGoalsWorkspaceVisible() {
        const page = this.pageOrThrow();
        const onGoalsUrl = /\/goals(\?|$)/.test(page.url());
        const anchor = page.getByText(/WHAT DO YOU DESIRE TODAY\?/i).first();
        const categories = page.getByText(/GOAL CATEGORIES/i).first();
        const hasAnchorText = (await anchor.count()) > 0 || (await categories.count()) > 0;
        if (!(onGoalsUrl && hasAnchorText)) {
            return false;
        }
        const archivedCount = await this.readGoalCount("Archived");
        if (config.SELFMAX_AUTH_MIN_ARCHIVED > 0) {
            return archivedCount !== null && archivedCount >= config.SELFMAX_AUTH_MIN_ARCHIVED;
        }
        return true;
    }
    async persistAuthState() {
        if (!this.context) {
            return;
        }
        const dir = dirname(config.SELFMAX_STORAGE_STATE_PATH);
        mkdirSync(dir, { recursive: true });
        await this.context.storageState({ path: config.SELFMAX_STORAGE_STATE_PATH });
    }
    async tryClickByText(root, texts, scope) {
        const searchRoot = scope ?? root;
        for (const text of texts) {
            const candidates = [
                searchRoot.getByRole("button", { name: new RegExp(`^${this.escapeRegex(text)}$`, "i") }).first(),
                searchRoot.getByRole("button", { name: new RegExp(this.escapeRegex(text), "i") }).first(),
                searchRoot.getByRole("link", { name: new RegExp(this.escapeRegex(text), "i") }).first(),
                searchRoot.getByText(text, { exact: true }).first(),
                searchRoot.getByText(new RegExp(this.escapeRegex(text), "i")).first()
            ];
            for (const candidate of candidates) {
                if ((await candidate.count()) === 0) {
                    continue;
                }
                if (!(await candidate.isVisible().catch(() => false))) {
                    continue;
                }
                try {
                    await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
                    await candidate.click({ timeout: 1500 });
                    return true;
                }
                catch {
                    continue;
                }
            }
        }
        return false;
    }
    escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    titleCase(value) {
        return value
            .split(/[_\s-]+/)
            .filter((part) => part.length > 0)
            .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
            .join(" ");
    }
    normalizeDateInput(input) {
        const trimmed = input.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return trimmed;
        }
        const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mdy) {
            const month = mdy[1].padStart(2, "0");
            const day = mdy[2].padStart(2, "0");
            return `${mdy[3]}-${month}-${day}`;
        }
        return null;
    }
    cacheGoal(entry) {
        const existing = this.entityCache.goalsById[entry.goalId];
        this.entityCache.goalsById[entry.goalId] = {
            goalId: entry.goalId,
            title: entry.title ?? existing?.title,
            category: entry.category ?? existing?.category,
            dueLabel: entry.dueLabel ?? existing?.dueLabel,
            progressLabel: entry.progressLabel ?? existing?.progressLabel,
            taskPanelState: entry.taskPanelState ?? existing?.taskPanelState,
            taskSummaryLabel: entry.taskSummaryLabel ?? existing?.taskSummaryLabel,
            taskPreviewItems: entry.taskPreviewItems ?? existing?.taskPreviewItems,
            lastSeenAt: new Date().toISOString()
        };
    }
    cacheDesire(entry) {
        const existing = this.entityCache.desiresById[entry.desireId];
        this.entityCache.desiresById[entry.desireId] = {
            desireId: entry.desireId,
            title: entry.title ?? existing?.title,
            category: entry.category ?? existing?.category,
            lastSeenAt: new Date().toISOString()
        };
    }
    findDesireIdByTitle(title) {
        const normalized = title.trim().toLowerCase();
        for (const entry of Object.values(this.entityCache.desiresById)) {
            if (entry.title?.trim().toLowerCase() === normalized) {
                return entry.desireId;
            }
        }
        return undefined;
    }
    storageKeyFor(session) {
        return `${config.SELFMAX_STATE_KEY}:${session.userId}:${session.sessionId}`;
    }
}
