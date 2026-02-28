#!/usr/bin/env node

import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function parseArgs(argv) {
  const mode = argv[2] ?? "sequence";
  const args = { mode };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--route") {
      args.route = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--url") {
      args.url = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--goal-id") {
      args.goalId = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--desire-id") {
      args.desireId = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--wait-ms") {
      args.waitMs = Number(argv[i + 1] ?? "0");
      i += 1;
      continue;
    }
    if (token === "--goal-title") {
      args.goalTitle = argv[i + 1] ?? "MVP Automation Goal";
      i += 1;
      continue;
    }
    if (token === "--desire-title") {
      args.desireTitle = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--task") {
      args.task = argv[i + 1] ?? "MVP task A";
      i += 1;
      continue;
    }
    if (token === "--message") {
      args.message = argv[i + 1] ?? "Quick check-in from automation.";
      i += 1;
      continue;
    }
  }
  return args;
}

function summarize(result) {
  return {
    id: result.id,
    ok: result.ok,
    error: result.error ?? null,
    result: result.result ?? null
  };
}

function isActiveGoalLimitError(result) {
  const message = String(result?.error ?? "");
  return (
    /You can only have 10 active goals at a time/i.test(message) ||
    /create_goal submission did not increase active goal count \(before=10\b/i.test(message)
  );
}

async function findSafeGoalTitle(client, session) {
  const listed = await client.execute({ id: "list-safe-goals", name: "list_goals", payload: { filter: "active" } }, session);
  if (!listed.ok) {
    throw new Error(listed.error ?? "list_goals failed while resolving safe goal");
  }
  const goals = listed.result?.goals ?? [];
  const safeGoal = goals.find((goal) => typeof goal?.title === "string" && goal.title.includes("MVP Automation Goal"));
  if (!safeGoal?.title) {
    throw new Error("no safe active goal found matching 'MVP Automation Goal'");
  }
  return safeGoal.title;
}

async function runRecoverableSequence(client, session, { goalTitle, task, message, loginFirst = true }) {
  const steps = [];
  let workingGoalTitle = goalTitle;
  let workingTaskText = task;

  if (loginFirst) {
    const loginStep = { id: "1", name: "login" };
    const loginRes = await client.execute(loginStep, session);
    steps.push({ step: loginStep.name, ...summarize(loginRes) });
    if (!loginRes.ok) {
      return steps;
    }
  }
  const talkStep = { id: "2", name: "talk_to_guide", payload: { message } };
  const talkRes = await client.execute(talkStep, session);
  steps.push({ step: talkStep.name, ...summarize(talkRes) });
  if (!talkRes.ok) {
    return steps;
  }

  const createStep = { id: "3", name: "create_goal", payload: { title: goalTitle, category: "Meaning" } };
  const createRes = await client.execute(createStep, session);
  steps.push({ step: createStep.name, ...summarize(createRes) });

  if (createRes.ok) {
    workingGoalTitle = goalTitle;
  } else if (isActiveGoalLimitError(createRes)) {
    workingGoalTitle = await findSafeGoalTitle(client, session);
    steps.push({
      step: "sequence_recovery",
      id: "3r",
      ok: true,
      error: null,
      result: {
        reason: "active_goal_limit",
        usingExistingGoalTitle: workingGoalTitle
      }
    });
  } else {
    return steps;
  }

  const followup = [
    { id: "4", name: "start_goal", payload: { goalTitle: workingGoalTitle } },
    { id: "5", name: "add_tasks", payload: { goalTitle: workingGoalTitle, tasks: [workingTaskText] } }
  ];

  for (const step of followup) {
    const res = await client.execute(step, session);
    steps.push({ step: step.name, ...summarize(res) });
    if (step.name === "add_tasks" && res.ok) {
      const taskTexts = res.result?.taskTexts;
      if (Array.isArray(taskTexts) && typeof taskTexts[0] === "string" && taskTexts[0].trim()) {
        workingTaskText = taskTexts[0];
      }
    }
    if (!res.ok) {
      break;
    }
  }

  const tail = [
    { id: "6", name: "complete_task", payload: { goalTitle: workingGoalTitle, taskText: workingTaskText } },
    { id: "7", name: "uncomplete_task", payload: { goalTitle: workingGoalTitle, taskText: workingTaskText } },
    { id: "8", name: "remove_task", payload: { goalTitle: workingGoalTitle, taskText: workingTaskText } },
    { id: "9", name: "archive_goal", payload: { goalTitle: workingGoalTitle } }
  ];

  for (const step of tail) {
    const res = await client.execute(step, session);
    steps.push({ step: step.name, ...summarize(res) });
    if (!res.ok) {
      break;
    }
  }

  return steps;
}

async function inspectGoalCard(page, goalTitle) {
  await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (requestedTitle) => (document.body.innerText || "").includes(requestedTitle),
    goalTitle,
    { timeout: 5000 }
  ).catch(() => undefined);
  return page.evaluate((requestedTitle) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const rows = Array.from(document.querySelectorAll("article, section, li, div"));
    const candidates = rows
      .map((el) => ({ el, text: normalize(el.textContent || "") }))
      .filter(({ text }) => text.includes(requestedTitle))
      .sort((a, b) => a.text.length - b.text.length);
    const row = candidates[0]?.el;
    if (!row) return { found: false };
    const text = normalize(row.textContent || "");
    const buttons = Array.from(row.querySelectorAll("button, [role='button']")).map((el) => normalize(el.textContent || "")).filter(Boolean);
    const links = Array.from(row.querySelectorAll("a[href]")).map((el) => ({ text: normalize(el.textContent || ""), href: el.getAttribute("href") || "" }));
    const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]')).map((el) => ({ checked: el.checked }));
    return {
      found: true,
      text,
      buttons,
      links,
      checkboxes,
      html: row.outerHTML.slice(0, 5000)
    };
  }, goalTitle);
}

async function inspectTaskDom(page, goalTitle, taskText) {
  await page.goto("https://www.selfmax.ai/self-maximize?goalId=gB2iS16QMK0l4JCIKeOe", { waitUntil: "domcontentloaded" }).catch(() => undefined);
  if (goalTitle) {
    await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
    const title = page.getByText(goalTitle, { exact: false }).first();
    await title.click().catch(() => undefined);
    const row = page.locator("div").filter({ hasText: taskText }).first();
    await row.hover().catch(() => undefined);
  }
  return page.evaluate((requestedTaskText) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const rows = Array.from(document.querySelectorAll("div, li, article, section, span, p"));
    const candidates = rows
      .map((el) => ({ el, text: normalize((el).innerText || el.textContent || "") }))
      .filter(({ text }) => text === requestedTaskText || text.includes(requestedTaskText))
      .sort((a, b) => a.text.length - b.text.length)
      .slice(0, 10);
    return candidates.map(({ el, text }) => {
      const parent = el.parentElement;
      return {
        text,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 300),
        parentTag: parent?.tagName.toLowerCase(),
        parentText: normalize(parent?.innerText || "").slice(0, 500),
        parentHtml: (parent?.outerHTML || "").slice(0, 3000),
        parentButtons: parent ? Array.from(parent.querySelectorAll("button")).map((button) => ({
          text: normalize(button.innerText || button.textContent || ""),
          ariaLabel: button.getAttribute("aria-label") || "",
          className: (button.getAttribute("class") || "").slice(0, 300)
        })) : [],
        html: el.outerHTML.slice(0, 1000)
      };
    });
  }, taskText);
}

async function clickTaskRowOnGoals(page, goalTitle, taskText) {
  await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
  const title = page.getByText(goalTitle, { exact: false }).first();
  await title.click().catch(() => undefined);
  const rowText = page.getByText(taskText, { exact: true }).first();
  await rowText.click().catch(() => undefined);
  await page.waitForTimeout(500);
}

async function inspectTaskDomInCurrentPage(page, taskText) {
  return page.evaluate((requestedTaskText) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const rows = Array.from(document.querySelectorAll("div, li, article, section, span, p, button"));
    const candidates = rows
      .map((el) => ({ el, text: normalize((el).innerText || el.textContent || "") }))
      .filter(({ text }) => text === requestedTaskText || text.includes(requestedTaskText))
      .sort((a, b) => a.text.length - b.text.length)
      .slice(0, 20);
    return candidates.map(({ el, text }) => {
      const parent = el.parentElement;
      const buttons = parent ? Array.from(parent.querySelectorAll("button")).map((button) => ({
        text: normalize(button.innerText || button.textContent || ""),
        ariaLabel: button.getAttribute("aria-label") || "",
        className: (button.getAttribute("class") || "").slice(0, 300)
      })) : [];
      return {
        text,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 300),
        parentTag: parent?.tagName.toLowerCase(),
        parentText: normalize(parent?.innerText || "").slice(0, 500),
        parentHtml: (parent?.outerHTML || "").slice(0, 3000),
        buttons,
        html: el.outerHTML.slice(0, 1000)
      };
    });
  }, taskText);
}

async function inspectTaskDomForGoal(client, session, goalTitle, taskText) {
  await ensureLoggedIn(client, session);
  await client.execute(
    { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle } },
    session
  );
  await client.execute(
    { id: "inspect-open-tasks", name: "read_task_panel_snapshot", payload: { goalTitle } },
    session
  );
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  return inspectTaskDom(page, goalTitle, taskText);
}

async function inspectTaskDomInGoalWorkspace(client, session, goalTitle, taskText) {
  await ensureLoggedIn(client, session);
  const started = await client.execute(
    { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle } },
    session
  );
  if (!started.ok) {
    throw new Error(started.error ?? "could not open goal workspace");
  }
  const openedTasks = await client.execute(
    { id: "inspect-open-tasks", name: "read_task_panel_snapshot", payload: { goalTitle } },
    session
  );
  if (!openedTasks.ok) {
    throw new Error(openedTasks.error ?? "could not open task panel");
  }
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  return inspectTaskDomInCurrentPage(page, taskText);
}

async function inspectCurrentPageButtons(page) {
  return page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("button, [role='button'], a"))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: normalize((el).innerText || el.textContent || ""),
        ariaLabel: el.getAttribute("aria-label") || "",
        title: el.getAttribute("title") || "",
        className: (el.getAttribute("class") || "").slice(0, 300)
      }))
      .filter((item) => item.text || item.ariaLabel || item.title)
      .slice(0, 300);
  });
}

async function inspectCurrentPageRoles(page) {
  return page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("[role]"))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        text: normalize((el).innerText || el.textContent || ""),
        ariaLabel: el.getAttribute("aria-label") || "",
        className: (el.getAttribute("class") || "").slice(0, 300)
      }))
      .filter((item) => item.role || item.text || item.ariaLabel)
      .slice(0, 300);
  });
}

async function capturePrimitiveNetwork(client, session, req) {
  await ensureLoggedIn(client, session);
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }

  const events = [];
  const onRequest = (request) => {
    const url = request.url();
    if (!/selfmax\.ai|firestore|firebase|googleapis|api/i.test(url)) return;
    events.push({
      type: "request",
      method: request.method(),
      url,
      postData: request.postData() ? request.postData().slice(0, 4000) : undefined
    });
  };
  const onResponse = async (response) => {
    const url = response.url();
    if (!/selfmax\.ai|firestore|firebase|googleapis|api/i.test(url)) return;
    let body;
    try {
      body = await response.text();
    } catch {
      body = undefined;
    }
    events.push({
      type: "response",
      status: response.status(),
      url,
      body: body ? body.slice(0, 4000) : undefined
    });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const result = await client.execute(req, session);
    return { result: summarize(result), events };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}

async function captureGoalsListenTraffic(client, session, waitMs = 4000) {
  await ensureLoggedIn(client, session);
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  const events = [];
  const onResponse = async (response) => {
    const url = response.url();
    if (!/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/i.test(url)) return;
    try {
      const body = await response.text();
      events.push({ url, body: body.slice(0, 20000) });
    } catch {
    }
  };
  page.on("response", onResponse);
  try {
    await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    return events;
  } finally {
    page.off("response", onResponse);
  }
}

async function fetchSelfMaximizeChunkSnippets(client, session) {
  await ensureLoggedIn(client, session);
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  const chunkUrl = "https://www.selfmax.ai/_next/static/chunks/app/(protected)/self-maximize/page-0fe79ee164a05f68.js";
  const text = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return res.text();
  }, chunkUrl);
  const patterns = [/Archive Goal/g, /Mark as Completed/g, /selfMaximizeSummaries/g, /collectionId":"desires"/g, /appearanceAndBehaviour/g, /archived/g];
  const snippets = [];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - 500);
    const end = Math.min(text.length, match.index + 1500);
    snippets.push({ pattern: pattern.source, snippet: text.slice(start, end) });
    pattern.lastIndex = 0;
  }
  return snippets;
}

async function openGoalWorkspaceEdit(client, session, goalTitle) {
  await ensureLoggedIn(client, session);
  const started = await client.execute(
    { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle } },
    session
  );
  if (!started.ok) {
    throw new Error(started.error ?? "could not open goal workspace");
  }
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  await page.getByRole("button", { name: /EDIT TASKS/i }).first().click().catch(() => undefined);
  await page.getByText(/^EDIT$/i).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  return page;
}

async function openGoalWorkspaceStatus(client, session, goalTitle) {
  await ensureLoggedIn(client, session);
  const started = await client.execute(
    { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle } },
    session
  );
  if (!started.ok) {
    throw new Error(started.error ?? "could not open goal workspace");
  }
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  await page.getByRole("button", { name: /Goal status/i }).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  return page;
}

async function ensureLoggedIn(client, session) {
  const login = await client.execute({ id: "login", name: "login" }, session);
  if (!login.ok) {
    console.log(JSON.stringify(summarize(login)));
    throw new Error(login.error ?? "login failed");
  }
}

async function runClientMode(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };

  const goalTitle = args.goalTitle ?? `MVP Automation Goal ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const task = args.task ?? `MVP task ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const message = args.message ?? "Quick check-in from automation.";

  try {
    await client.init();

    if (args.mode === "login") {
      const login = await client.execute({ id: "login", name: "login" }, session);
      console.log(JSON.stringify(summarize(login)));
      return;
    }

    if (args.mode === "probe") {
      const login = await client.execute({ id: "login", name: "login" }, session);
      const read = await client.execute({ id: "read", name: "read_coach_messages" }, session);
      console.log(JSON.stringify({ login: summarize(login), read: summarize(read) }));
      return;
    }

    if (args.mode === "sequence") {
      const results = await runRecoverableSequence(client, session, { goalTitle, task, message, loginFirst: true });
      for (const row of results) {
        console.log(JSON.stringify(row));
      }
      return;
    }

    if (args.mode === "start-by-id") {
      const res = await client.execute({ id: "start", name: "start_goal", payload: { goalId: args.goalId ?? "" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "archive-by-id") {
      const res = await client.execute({ id: "archive", name: "archive_goal", payload: { goalId: args.goalId ?? "" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "complete-by-id") {
      const res = await client.execute({ id: "complete", name: "complete_goal", payload: { goalId: args.goalId ?? "" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "complete-goal") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "complete-goal", name: "complete_goal", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "delete-by-id") {
      const res = await client.execute({ id: "delete", name: "delete_goal", payload: { goalId: args.goalId ?? "" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "discover-goals") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "discover", name: "discover_goals", payload: { waitMs: args.waitMs ?? 4000 } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goals-overview") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-goals-overview", name: "read_goals_overview" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-auth-state") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-auth-state", name: "read_auth_state" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-current-route") {
      const res = await client.execute({ id: "read-current-route", name: "read_current_route" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-known-routes") {
      const res = await client.execute({ id: "read-known-routes", name: "read_known_routes" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "route-snapshot") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "route-snapshot", name: "read_route_snapshot", payload: { route: args.route ?? "", url: args.url ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-page-sections") {
      const needsLogin = !args.route || ["goals", "lifestorming", "lifestorming_desires_selection"].includes(args.route);
      if (needsLogin) {
        await ensureLoggedIn(client, session);
      }
      const res = await client.execute(
        { id: "read-page-sections", name: "read_page_sections", payload: { route: args.route ?? "", url: args.url ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "discover-links") {
      const needsLogin = !args.route || ["goals", "lifestorming", "lifestorming_desires_selection"].includes(args.route);
      if (needsLogin) {
        await ensureLoggedIn(client, session);
      }
      const res = await client.execute(
        { id: "discover-links", name: "discover_links", payload: { route: args.route ?? "", url: args.url ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal", name: "read_goal", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal-metadata") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-metadata", name: "read_goal_metadata", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal-workspace") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-workspace", name: "read_goal_workspace", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal-full") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-full", name: "read_goal_full", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "goal-card-inspect") {
      await ensureLoggedIn(client, session);
      const page = client.page ?? client["page"];
      if (!page) {
        throw new Error("page unavailable");
      }
      const goalTitleToInspect = args.goalTitle ?? "";
      const result = await inspectGoalCard(page, goalTitleToInspect);
      console.log(JSON.stringify(result));
      return;
    }

    if (args.mode === "read-cached-goals") {
      const res = await client.execute({ id: "read-cached-goals", name: "read_cached_goals" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-cached-desires") {
      const res = await client.execute({ id: "read-cached-desires", name: "read_cached_desires" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-task-panel-snapshot") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        {
          id: "read-task-panel-snapshot",
          name: "read_task_panel_snapshot",
          payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" }
        },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "survey-active-goal-task-states") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "survey-active-goal-task-states", name: "survey_active_goal_task_states" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-lifestorming-overview") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-lifestorming-overview", name: "read_lifestorming_overview" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "list-desires") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "list-desires", name: "list_lifestorming_desires" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-desire-category") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-desire-category", name: "read_lifestorming_category", payload: { category: args.message ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-lifestorming-full") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-lifestorming-full", name: "read_lifestorming_full" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-sensation-practice") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        {
          id: "read-sensation-practice",
          name: "read_sensation_practice",
          payload: { desireId: args.desireId ?? "", desireTitle: args.desireTitle ?? "" }
        },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-tasks") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-tasks", name: "list_goal_tasks", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "task-dom-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      const taskTextToInspect = args.task ?? "";
      if (!goalTitleToInspect || !taskTextToInspect) {
        throw new Error("task-dom-inspect requires --goal-title and --task");
      }
      const result = await inspectTaskDomForGoal(client, session, goalTitleToInspect, taskTextToInspect);
      console.log(JSON.stringify(result));
      return;
    }

    if (args.mode === "task-click-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      const taskTextToInspect = args.task ?? "";
      if (!goalTitleToInspect || !taskTextToInspect) {
        throw new Error("task-click-inspect requires --goal-title and --task");
      }
      await ensureLoggedIn(client, session);
      const page = client.page ?? client["page"];
      if (!page) {
        throw new Error("page unavailable");
      }
      await clickTaskRowOnGoals(page, goalTitleToInspect, taskTextToInspect);
      console.log(JSON.stringify({
        buttons: await inspectCurrentPageButtons(page),
        snippet: await page.locator("body").innerText().catch(() => "")
      }));
      return;
    }

    if (args.mode === "workspace-task-dom-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      const taskTextToInspect = args.task ?? "";
      if (!goalTitleToInspect || !taskTextToInspect) {
        throw new Error("workspace-task-dom-inspect requires --goal-title and --task");
      }
      const result = await inspectTaskDomInGoalWorkspace(client, session, goalTitleToInspect, taskTextToInspect);
      console.log(JSON.stringify(result));
      return;
    }

    if (args.mode === "workspace-buttons-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      if (!goalTitleToInspect) {
        throw new Error("workspace-buttons-inspect requires --goal-title");
      }
      await ensureLoggedIn(client, session);
      const started = await client.execute(
        { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle: goalTitleToInspect } },
        session
      );
      if (!started.ok) {
        throw new Error(started.error ?? "could not open goal workspace");
      }
      const openedTasks = await client.execute(
        { id: "inspect-open-tasks", name: "read_task_panel_snapshot", payload: { goalTitle: goalTitleToInspect } },
        session
      );
      if (!openedTasks.ok) {
        throw new Error(openedTasks.error ?? "could not open task panel");
      }
      const page = client.page ?? client["page"];
      if (!page) {
        throw new Error("page unavailable");
      }
      console.log(JSON.stringify(await inspectCurrentPageButtons(page)));
      return;
    }

    if (args.mode === "workspace-edit-buttons-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      if (!goalTitleToInspect) {
        throw new Error("workspace-edit-buttons-inspect requires --goal-title");
      }
      const page = await openGoalWorkspaceEdit(client, session, goalTitleToInspect);
      console.log(JSON.stringify(await inspectCurrentPageButtons(page)));
      return;
    }

    if (args.mode === "workspace-status-buttons-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      if (!goalTitleToInspect) {
        throw new Error("workspace-status-buttons-inspect requires --goal-title");
      }
      const page = await openGoalWorkspaceStatus(client, session, goalTitleToInspect);
      console.log(JSON.stringify({
        buttons: await inspectCurrentPageButtons(page),
        roles: await inspectCurrentPageRoles(page),
        snippet: await page.locator("body").innerText().catch(() => "")
      }));
      return;
    }

    if (args.mode === "probe-add-task-network") {
      const goalTitleToUse = args.goalTitle ?? "";
      const taskTextToUse = args.task ?? "";
      if (!goalTitleToUse || !taskTextToUse) {
        throw new Error("probe-add-task-network requires --goal-title and --task");
      }
      const output = await capturePrimitiveNetwork(client, session, {
        id: "probe-add-task-network",
        name: "add_tasks",
        payload: { goalTitle: goalTitleToUse, tasks: [taskTextToUse] }
      });
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "probe-complete-task-network") {
      const goalTitleToUse = args.goalTitle ?? "";
      const taskTextToUse = args.task ?? "";
      if (!goalTitleToUse || !taskTextToUse) {
        throw new Error("probe-complete-task-network requires --goal-title and --task");
      }
      const output = await capturePrimitiveNetwork(client, session, {
        id: "probe-complete-task-network",
        name: "complete_task",
        payload: { goalTitle: goalTitleToUse, taskText: taskTextToUse }
      });
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "probe-archive-goal-network") {
      const goalTitleToUse = args.goalTitle ?? "";
      if (!goalTitleToUse) {
        throw new Error("probe-archive-goal-network requires --goal-title");
      }
      const output = await capturePrimitiveNetwork(client, session, {
        id: "probe-archive-goal-network",
        name: "archive_goal",
        payload: { goalTitle: goalTitleToUse }
      });
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "probe-goals-listen") {
      const events = await captureGoalsListenTraffic(client, session, args.waitMs ?? 4000);
      console.log(JSON.stringify(events));
      return;
    }

    if (args.mode === "probe-self-maximize-chunk") {
      const snippets = await fetchSelfMaximizeChunkSnippets(client, session);
      console.log(JSON.stringify(snippets));
      return;
    }

    if (args.mode === "read-goal-chat") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-chat", name: "read_goal_chat", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "add-tasks") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "add-tasks", name: "add_tasks", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "", tasks: [args.task ?? "MVP task"] } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "complete-task") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "complete-task", name: "complete_task", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "", taskText: args.task ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "uncomplete-task") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "uncomplete-task", name: "uncomplete_task", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "", taskText: args.task ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "remove-task") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "remove-task", name: "remove_task", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "", taskText: args.task ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    throw new Error(`unsupported mode for client runner: ${args.mode}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runKeepOpenMode(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  const goalTitleBase = args.goalTitle ?? "MVP Automation Goal";
  const taskBase = args.task ?? "MVP task";
  const message = args.message ?? "Quick check-in from automation.";

  let sequenceRound = 0;

  const rl = createInterface({ input, output });
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    console.log(JSON.stringify({ step: "login", ...summarize(login) }));
    if (!login.ok) {
      return;
    }

    process.stdout.write(
      [
        "keep-open session ready.",
        "commands:",
        "  sequence                     run MVP sequence without re-login",
        "  primitive <name> <json>      run one primitive with JSON payload",
        "  inspect-card <goal title>    inspect /goals card DOM for a goal",
        "  inspect-task <goal> | <task> inspect task DOM on /self-maximize",
        "  examples: read_goals_overview, read_goal, read_page_sections, discover_links",
        "  exit                         close browser and quit"
      ].join("\n") + "\n"
    );

    while (true) {
      let line = "";
      try {
        line = (await rl.question("> ")).trim();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/readline was closed/i.test(message)) {
          break;
        }
        throw error;
      }
      if (!line) {
        continue;
      }
      if (line.toLowerCase() === "exit") {
        break;
      }
      if (line.toLowerCase() === "sequence") {
        sequenceRound += 1;
        const runStamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sequenceRound}`;
        const goalTitle = `${goalTitleBase} ${runStamp}`;
        const task = `${taskBase} ${runStamp}`;
        const results = await runRecoverableSequence(client, session, { goalTitle, task, message, loginFirst: false });
        for (const row of results) {
          console.log(JSON.stringify(row));
        }
        continue;
      }
      if (line.toLowerCase().startsWith("inspect-card ")) {
        const goalTitle = line.slice("inspect-card ".length).trim();
        const page = client.page ?? client["page"];
        if (!goalTitle || !page) {
          console.log(JSON.stringify({ ok: false, error: "goal title or page unavailable" }));
          continue;
        }
        console.log(JSON.stringify(await inspectGoalCard(page, goalTitle)));
        continue;
      }
      if (line.toLowerCase().startsWith("inspect-task ")) {
        const raw = line.slice("inspect-task ".length);
        const [goalTitle, taskText] = raw.split("|").map((part) => part.trim());
        const page = client.page ?? client["page"];
        if (!goalTitle || !taskText || !page) {
          console.log(JSON.stringify({ ok: false, error: "usage: inspect-task <goal title> | <task text>" }));
          continue;
        }
        console.log(JSON.stringify(await inspectTaskDom(page, goalTitle, taskText)));
        continue;
      }
      if (line.toLowerCase().startsWith("primitive ")) {
        const raw = line.slice("primitive ".length).trim();
        const firstSpace = raw.indexOf(" ");
        const name = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
        const payloadRaw = firstSpace === -1 ? "{}" : raw.slice(firstSpace + 1);
        let payload;
        try {
          payload = JSON.parse(payloadRaw);
        } catch (error) {
          console.log(JSON.stringify({ ok: false, error: `invalid json payload: ${String(error)}` }));
          continue;
        }
        const req = { id: `${Date.now()}`, name, payload };
        const res = await client.execute(req, session);
        console.log(JSON.stringify({ step: name, ...summarize(res) }));
        continue;
      }

      console.log(JSON.stringify({ ok: false, error: "unknown command" }));
    }
  } finally {
    rl.close();
    await client.close().catch(() => undefined);
  }
}

async function runSigninDiagnostic() {
  const { config } = await import("../dist/config.js");

  const browser = await chromium.launch({ headless: config.HEADLESS });
  const page = await browser.newPage();

  try {
    const base = config.SELFMAX_BASE_URL.replace(/\/$/, "");
    await page.goto(`${base}/auth?mode=sign-in&v=b`, { waitUntil: "domcontentloaded" });

    await page.locator('input[type="email"], input[name*="email" i]').first().fill(config.SELFMAX_EMAIL);
    await page.locator('input[type="password"], input[name*="password" i]').first().fill(config.SELFMAX_PASSWORD);

    const formSnapshot = await page.evaluate(() => {
      const emailEl = document.querySelector('input[type="email"], input[name*="email" i]');
      const passEl = document.querySelector('input[type="password"], input[name*="password" i]');
      const emailValue = emailEl && "value" in emailEl ? String(emailEl.value ?? "") : "";
      const passValue = passEl && "value" in passEl ? String(passEl.value ?? "") : "";
      return {
        emailLen: emailValue.length,
        emailHasAt: emailValue.includes("@"),
        passwordLen: passValue.length
      };
    });

    const exactSignIn = page.getByRole("button", { name: /^sign in$/i }).first();
    if ((await exactSignIn.count()) > 0) {
      await exactSignIn.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    await page.waitForTimeout(5000);

    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800);
    const current = new URL(page.url());
    if (current.searchParams.has("email")) {
      current.searchParams.set("email", "REDACTED");
    }
    if (current.searchParams.has("password")) {
      current.searchParams.set("password", "REDACTED");
    }

    console.log(
      JSON.stringify({
        url: current.toString(),
        formSnapshot,
        hasDesire: text.includes("WHAT DO YOU DESIRE TODAY?"),
        hasCategories: text.includes("GOAL CATEGORIES"),
        text
      })
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function runGoalsInspect() {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const page = client.page ?? client["page"];
    if (!page) {
      throw new Error("page unavailable");
    }
    await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
    const snapshot = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], a[href]"))
        .slice(0, 200)
        .map((el) => {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) {
            return null;
          }
          return {
            tag: el.tagName.toLowerCase(),
            text: text.slice(0, 120),
            href: el instanceof HTMLAnchorElement ? el.href : null,
            id: el.id || null,
            cls: (el.getAttribute("class") || "").slice(0, 120),
            dataGoalId:
              el.getAttribute("data-goal-id") ||
              el.getAttribute("data-goalid") ||
              el.getAttribute("goalid") ||
              null
          };
        })
        .filter(Boolean);
      const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1200);
      return { buttons, bodyText, url: location.href };
    });
    console.log(JSON.stringify({ login: summarize(login), ...snapshot }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runCreateGoalInspect() {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const page = client.page ?? client["page"];
    if (!page) {
      throw new Error("page unavailable");
    }
    await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
    const before = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1000);

    const openers = [
      page.getByRole("button", { name: /NEW GOAL/i }).first(),
      page.getByText(/I KNOW WHAT MY GOAL IS/i).first(),
      page.getByText(/Create a New Goal/i).first()
    ];
    for (const opener of openers) {
      if ((await opener.count()) > 0) {
        await opener.click().catch(() => undefined);
        break;
      }
    }
    await page.waitForTimeout(600);

    const snapshot = await page.evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1400);
      const inputs = Array.from(document.querySelectorAll("input, textarea")).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: "type" in el ? String(el.type || "") : "",
        placeholder: "placeholder" in el ? String(el.placeholder || "") : "",
        name: "name" in el ? String(el.name || "") : "",
        valueLen: "value" in el ? String(el.value || "").length : 0
      }));
      const createButtons = Array.from(document.querySelectorAll("button, [role='button']"))
        .map((el) => {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!/create goal|create/i.test(text)) {
            return null;
          }
          return {
            text,
            disabled: (el).disabled === true || el.getAttribute("aria-disabled") === "true",
            cls: (el.getAttribute("class") || "").slice(0, 120)
          };
        })
        .filter(Boolean);
      const categoryButtons = Array.from(document.querySelectorAll("button, [role='button']"))
        .map((el) => {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!/^(Health|Work|Love|Family|Social|Fun|Dreams|Meaning)$/i.test(text)) {
            return null;
          }
          return {
            text,
            ariaPressed: el.getAttribute("aria-pressed"),
            ariaSelected: el.getAttribute("aria-selected"),
            cls: (el.getAttribute("class") || "").slice(0, 120)
          };
        })
        .filter(Boolean);
      return {
        url: location.href,
        hasCreateHeading: /Create a New Goal/i.test(document.body.innerText || ""),
        hasCategoryPrompt: /Choose a category for your goal/i.test(document.body.innerText || ""),
        hasCategoryError: /Please select a category for your goal/i.test(document.body.innerText || ""),
        hasDueDatePrompt: /Set a due date for your goal/i.test(document.body.innerText || ""),
        inputs,
        createButtons,
        categoryButtons,
        text
      };
    });

    console.log(JSON.stringify({ login: summarize(login), before, after: snapshot }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runCreateGoalPrimitiveInspect(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  const goalTitle = args.goalTitle ?? `MVP Automation Goal ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const create = await client.execute(
      { id: "2", name: "create_goal", payload: { title: goalTitle, category: "Meaning" } },
      session
    );
    const page = client.page ?? client["page"];
    if (!page) {
      throw new Error("page unavailable");
    }
    const snapshot = await page.evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1800);
      const inputs = Array.from(document.querySelectorAll("input, textarea")).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: "type" in el ? String(el.type || "") : "",
        placeholder: "placeholder" in el ? String(el.placeholder || "") : "",
        value: "value" in el ? String(el.value || "") : "",
        valueLen: "value" in el ? String(el.value || "").length : 0
      }));
      const createButtons = Array.from(document.querySelectorAll("button, [role='button']"))
        .map((el) => {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!/create goal/i.test(text)) {
            return null;
          }
          return {
            text,
            disabled: (el).disabled === true || el.getAttribute("aria-disabled") === "true",
            cls: (el.getAttribute("class") || "").slice(0, 120)
          };
        })
        .filter(Boolean);
      return {
        url: location.href,
        hasCreateHeading: /Create a New Goal/i.test(document.body.innerText || ""),
        hasCategoryError: /Please select a category for your goal/i.test(document.body.innerText || ""),
        hasDueDatePrompt: /Set a due date for your goal/i.test(document.body.innerText || ""),
        inputs,
        createButtons,
        text
      };
    });
    console.log(JSON.stringify({ login: summarize(login), create: summarize(create), snapshot }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runCreateGoalSubmitProbe(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  const goalTitle = args.goalTitle ?? `Probe Goal ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const page = client.page ?? client["page"];
    if (!page) {
      throw new Error("page unavailable");
    }
    const network = [];
    let createPost = null;
    page.on("requestfinished", async (req) => {
      const url = req.url();
      if (!/goal|selfmax|firebase|api/i.test(url)) return;
      const res = await req.response();
      const item = { type: "finished", url, method: req.method(), status: res?.status() ?? null };
      network.push(item);
      if (req.method() === "POST" && /\/goals(\?|$)/.test(url) && res) {
        let body = "";
        try {
          body = (await res.text()).replace(/\s+/g, " ").slice(0, 1200);
        } catch {
          body = "";
        }
        createPost = { ...item, body };
      }
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (!/goal|selfmax|firebase|api/i.test(url)) return;
      network.push({ type: "failed", url, method: req.method(), failure: req.failure()?.errorText ?? "unknown" });
    });

    await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /NEW GOAL/i }).first().click();
    await page.locator('textarea[placeholder*="E.g." i]').first().fill(goalTitle);
    await page.getByText(/^Meaning$/i).last().click();
    await page.getByRole("button", { name: /^Create Goal$/i }).click();
    await page.waitForTimeout(2500);

    const snapshot = await page.evaluate(() => ({
      url: location.href,
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1400)
    }));
    console.log(JSON.stringify({ login: summarize(login), goalTitle, createPost, network: network.slice(-30), snapshot }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "--help" || args.mode === "help" || args.mode === "-h") {
    process.stdout.write(
      [
        "Usage: node scripts/selfmax-smoke.mjs <mode> [options]",
        "",
        "Modes:",
        "  login              Run login primitive only",
        "  probe              Run login + read_coach_messages probe",
        "  sequence           Run full MVP smoke sequence",
        "  start-by-id        Start goal by goalId",
        "  archive-by-id      Archive goal by goalId",
        "  delete-by-id       Delete goal by goalId",
        "  discover-goals     Read-only goal discovery from DOM + stream",
        "  read-goals-overview Read-only goals dashboard snapshot",
        "  route-snapshot     Generic route/url snapshot",
        "  read-goal          Read goal status blocks (by goalId/title)",
        "  read-goal-workspace Read visible self-maximize workspace layout",
        "  read-tasks         Read task list for a goal (by goalId/title)",
        "  read-goal-chat     Read goal chat messages (by goalId/title)",
        "  read-lifestorming-overview Read lifestorming landing overview",
        "  list-desires       Read lifestorming desire buckets/items",
        "  read-desire-category Read a single lifestorming category panel",
        "  keep-open          Login once and keep browser/session open",
        "  goals-list         Login + list goals (and discovered goalIds)",
        "  goals-discover-ids Discover goalIds from Firestore listen stream",
        "  signin-diagnostic  Run direct /auth sign-in diagnostic",
        "  goals-inspect      Dump action/link snapshot from /goals",
        "  create-goal-inspect Inspect create-goal UI after pressing NEW GOAL",
        "  create-goal-primitive-inspect Run create_goal primitive and dump resulting UI state",
        "  create-goal-submit-probe Raw create-goal submit + network probe",
        "",
        "Options:",
        "  --goal-title <title>   Goal title for sequence mode",
        "  --goal-id <id>         Goal id for *-by-id modes",
        "  --wait-ms <n>          Extra wait for discovery-style reads",
        "  --task <task>          Task text for sequence mode",
        "  --message <message>    Chat message for guide step",
        "",
        "Examples:",
        "  node scripts/selfmax-smoke.mjs login",
        "  node scripts/selfmax-smoke.mjs goals-list",
        "  node scripts/selfmax-smoke.mjs goals-discover-ids",
        "  node scripts/selfmax-smoke.mjs discover-goals --wait-ms 15000",
        "  node scripts/selfmax-smoke.mjs read-goals-overview",
        "  node scripts/selfmax-smoke.mjs route-snapshot --message goals",
        "  node scripts/selfmax-smoke.mjs read-goal --goal-id <id>",
        "  node scripts/selfmax-smoke.mjs read-goal-workspace --goal-id <id>",
        "  node scripts/selfmax-smoke.mjs read-tasks --goal-id <id>",
        "  node scripts/selfmax-smoke.mjs read-lifestorming-overview",
        "  node scripts/selfmax-smoke.mjs list-desires",
        "  node scripts/selfmax-smoke.mjs read-desire-category --message Health",
        "  node scripts/selfmax-smoke.mjs start-by-id --goal-id <id>",
        "  node scripts/selfmax-smoke.mjs sequence --goal-title \"MVP Automation Goal\" --task \"MVP task A\"",
        "  node scripts/selfmax-smoke.mjs keep-open",
        "  node scripts/selfmax-smoke.mjs signin-diagnostic",
        "  node scripts/selfmax-smoke.mjs goals-inspect",
        "  node scripts/selfmax-smoke.mjs create-goal-inspect",
        "  node scripts/selfmax-smoke.mjs create-goal-primitive-inspect",
        "  node scripts/selfmax-smoke.mjs create-goal-submit-probe"
      ].join("\n") + "\n"
    );
    return;
  }

  if (args.mode === "signin-diagnostic") {
    await runSigninDiagnostic();
    return;
  }

  if (args.mode === "goals-list") {
    const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
    const client = new SelfMaxPlaywrightClient();
    const session = { sessionId: "smoke-session", userId: "smoke-user" };
    try {
      await client.init();
      const login = await client.execute({ id: "1", name: "login" }, session);
      const list = await client.execute(
        { id: "2", name: "list_goals", payload: { filter: args.message ?? "all" } },
        session
      );
      console.log(JSON.stringify({ login: summarize(login), list: summarize(list) }));
      return;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  if (args.mode === "goals-discover-ids") {
    const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
    const client = new SelfMaxPlaywrightClient();
    const session = { sessionId: "smoke-session", userId: "smoke-user" };
    try {
      await client.init();
      const login = await client.execute({ id: "1", name: "login" }, session);
      const ids = await client.execute({ id: "2", name: "discover_goal_ids" }, session);
      console.log(JSON.stringify({ login: summarize(login), ids: summarize(ids) }));
      return;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  if (args.mode === "goals-inspect") {
    await runGoalsInspect();
    return;
  }

  if (args.mode === "create-goal-inspect") {
    await runCreateGoalInspect();
    return;
  }

  if (args.mode === "create-goal-primitive-inspect") {
    await runCreateGoalPrimitiveInspect(args);
    return;
  }

  if (args.mode === "create-goal-submit-probe") {
    await runCreateGoalSubmitProbe(args);
    return;
  }

  if (args.mode === "task-inspect") {
    const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
    const client = new SelfMaxPlaywrightClient();
    const session = { sessionId: "smoke-session", userId: "smoke-user" };
    const goalTitle = args.goalTitle ?? "MVP Automation Goal";
    try {
      await client.init();
      const login = await client.execute({ id: "1", name: "login" }, session);
      const start = await client.execute({ id: "2", name: "start_goal", payload: { goalTitle } }, session);

      const page = client.page ?? client["page"];
      if (!page) {
        throw new Error("page unavailable");
      }
      await page.getByText(/TASKS/i).first().click().catch(() => undefined);
      await page.waitForTimeout(600);

      const snapshot = await page.evaluate(() => {
        const textboxes = Array.from(document.querySelectorAll("textarea, input, [contenteditable='true']")).map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            type: "type" in el ? String((el).type ?? "") : "",
            placeholder: "placeholder" in el ? String((el).placeholder ?? "") : "",
            name: "name" in el ? String((el).name ?? "") : "",
            id: el.id ?? "",
            contentEditable: el.getAttribute("contenteditable") ?? "",
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
          };
        });
        const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1200);
        return { textboxes, bodyText };
      });

      console.log(
        JSON.stringify({
          login: summarize(login),
          start: summarize(start),
          url: page.url(),
          ...snapshot
        })
      );
      return;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  if (args.mode === "keep-open") {
    await runKeepOpenMode(args);
    return;
  }

  await runClientMode(args);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
