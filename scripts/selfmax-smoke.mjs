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
    if (token === "--name") {
      args.name = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--payload-json") {
      args.payloadJson = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--status") {
      args.status = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--due-date") {
      args.dueDate = argv[i + 1] ?? "";
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

function nextIsoDate(daysFromToday = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
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

async function readBodyText(client) {
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  return page.locator("body").innerText().catch(() => "");
}

async function waitForBodyIncludes(client, needles, timeoutMs = 6000) {
  const page = client.page ?? client["page"];
  if (!page) {
    throw new Error("page unavailable");
  }
  const expected = needles.filter((value) => typeof value === "string" && value.trim().length > 0);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readBodyText(client);
    if (expected.every((needle) => text.includes(needle))) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function runStep(client, session, steps, step) {
  const res = await client.execute(step, session);
  const row = { step: step.name, ...summarize(res) };
  steps.push(row);
  return res;
}

async function findActiveGoalByState(client, session, desiredState, predicate = () => true) {
  const listed = await client.execute({ id: `list-${desiredState}`, name: "list_goals", payload: { filter: "active" } }, session);
  if (!listed.ok) {
    throw new Error(listed.error ?? "list_goals failed while resolving active goal");
  }
  const goals = Array.isArray(listed.result?.goals) ? listed.result.goals : [];
  return goals.find((goal) => goal?.taskPanelState === desiredState && predicate(goal)) ?? null;
}

async function ensureGoalCapacity(client, session, steps, slotsNeeded = 1) {
  const auth = await client.execute({ id: "auth-state", name: "read_auth_state" }, session);
  steps.push({ step: "read_auth_state", ...summarize(auth) });
  if (!auth.ok) {
    throw new Error(auth.error ?? "read_auth_state failed");
  }
  let activeCount = Number(auth.result?.activeCount ?? 0);
  const archivedTitles = [];
  while (activeCount + slotsNeeded > 10) {
    const safeGoalTitle = await findSafeGoalTitle(client, session);
    const archiveRes = await client.execute({ id: `archive-capacity-${archivedTitles.length}`, name: "update_goal", payload: { goalTitle: safeGoalTitle, status: "archived" } }, session);
    steps.push({ step: "archive_goal_for_capacity", ...summarize(archiveRes) });
    if (!archiveRes.ok) {
      throw new Error(archiveRes.error ?? `could not archive safe goal for capacity: ${safeGoalTitle}`);
    }
    archivedTitles.push(safeGoalTitle);
    activeCount -= 1;
  }
  return { archivedTitles };
}

async function runRecoverableSequence(client, session, { goalTitle, task, message, loginFirst = true }) {
  const steps = [];
  let workingGoalTitle = goalTitle;
  let chatGoalTitle = goalTitle;
  let taskGoalTitle = goalTitle;
  let lifecycleGoalTitle = goalTitle;
  let workingTaskText = task;
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directGoalTitle = goalTitle;
  const lifestormGoalTitle = `Lifestorm Goal ${runStamp}`;
  const brainstormMeaning = `Lifestorm Desire Meaning ${runStamp}`;
  const brainstormHealth = `Lifestorm Desire Health ${runStamp}`;
  const guideMessageA = `${message} [guide-a ${runStamp}]`;
  const guideMessageB = `${message} [guide-b ${runStamp}]`;
  const goalMessageA = `Goal chat ping A ${runStamp}`;
  const goalMessageB = `Goal chat ping B ${runStamp}`;
  const reflectionNotes = `Reflection by title ${runStamp}`;
  let directGoalCreated = false;
  let lifestormGoalCreated = false;
  const createDueDate = nextIsoDate(7);
  const lifestormDueDate = nextIsoDate(10);

  if (loginFirst) {
    const loginStep = { id: "1", name: "login" };
    const loginRes = await client.execute(loginStep, session);
    steps.push({ step: loginStep.name, ...summarize(loginRes) });
    if (!loginRes.ok) {
      return steps;
    }
  }
  const guideTalkA = await runStep(client, session, steps, { id: "2a", name: "talk_to_guide", payload: { message: guideMessageA } });
  if (!guideTalkA.ok) {
    return steps;
  }
  const guideReadA = await runStep(client, session, steps, { id: "2ar", name: "read_coach_messages" });
  const guideTalkB = await runStep(client, session, steps, { id: "2b", name: "talk_to_guide", payload: { message: guideMessageB } });
  if (!guideTalkB.ok) {
    return steps;
  }
  const guideReadB = await runStep(client, session, steps, { id: "2br", name: "read_coach_messages" });
  if (!guideReadA.ok || !guideReadB.ok) {
    return steps;
  }
  steps.push({
    step: "guide_chat_continuity",
    id: "2c",
    ok: Array.isArray(guideReadB.result) && guideReadB.result.length >= (Array.isArray(guideReadA.result) ? guideReadA.result.length : 0),
    error: null,
    result: {
      firstReadCount: Array.isArray(guideReadA.result) ? guideReadA.result.length : 0,
      secondReadCount: Array.isArray(guideReadB.result) ? guideReadB.result.length : 0
    }
  });

  const brainstormRes = await runStep(client, session, steps, {
    id: "3",
    name: "brainstorm_desires_for_each_category",
    payload: {
      itemsByCategory: {
        meaning: [brainstormMeaning],
        health: [brainstormHealth]
      }
    }
  });
  if (!brainstormRes.ok) {
    return steps;
  }
  const lifestormOverview = await runStep(client, session, steps, {
    id: "3o",
    name: "read_lifestorming_overview"
  });
  const visibleDesires = Array.isArray(lifestormOverview.result?.visibleDesires) ? lifestormOverview.result.visibleDesires : [];
  steps.push({
    step: "brainstorm_verify",
    id: "3v",
    ok:
      visibleDesires.includes(brainstormMeaning) &&
      visibleDesires.includes(brainstormHealth),
    error: null,
    result: {
      meaningFound: visibleDesires.includes(brainstormMeaning),
      healthFound: visibleDesires.includes(brainstormHealth)
    }
  });

  const feelOut = await runStep(client, session, steps, {
    id: "4",
    name: "feel_out_desires",
    payload: { desires: [{ title: "Begin praying every day", notes: reflectionNotes }] }
  });
  if (!feelOut.ok) {
    return steps;
  }
  const feelOutRead = await runStep(client, session, steps, {
    id: "4r",
    name: "read_sensation_practice",
    payload: { desireTitle: "Begin praying every day" }
  });
  steps.push({
    step: "feel_out_persistence",
    id: "4v",
    ok: String(feelOutRead.result?.noteText ?? "").includes(reflectionNotes),
    error: null,
    result: {
      expected: reflectionNotes,
      actual: feelOutRead.result?.noteText ?? ""
    }
  });

  await ensureGoalCapacity(client, session, steps, 1);
  const lifestormCreate = await runStep(client, session, steps, {
    id: "5",
    name: "create_goals_from_desires",
    payload: { desires: [{ title: lifestormGoalTitle, category: "Meaning", dueDate: lifestormDueDate }] }
  });
  if (lifestormCreate.ok) {
    lifestormGoalCreated = true;
  } else if (isActiveGoalLimitError(lifestormCreate)) {
    await ensureGoalCapacity(client, session, steps, 1);
    const retry = await runStep(client, session, steps, {
      id: "5r",
      name: "create_goals_from_desires",
      payload: { desires: [{ title: lifestormGoalTitle, category: "Meaning", dueDate: lifestormDueDate }] }
    });
    lifestormGoalCreated = retry.ok;
    if (!retry.ok) {
      return steps;
    }
  } else {
    return steps;
  }

  await ensureGoalCapacity(client, session, steps, 1);
  const createStep = { id: "6", name: "create_goal", payload: { title: directGoalTitle, category: "Meaning", dueDate: createDueDate } };
  const createRes = await client.execute(createStep, session);
  steps.push({ step: createStep.name, ...summarize(createRes) });

  if (createRes.ok) {
    directGoalCreated = true;
  } else if (isActiveGoalLimitError(createRes)) {
    await ensureGoalCapacity(client, session, steps, 1);
    const retry = await client.execute({ ...createStep, id: "6r" }, session);
    steps.push({ step: "create_goal_retry", ...summarize(retry) });
    if (retry.ok) {
      directGoalCreated = true;
    } else {
      steps.push({
        step: "sequence_recovery",
        id: "6rr",
        ok: true,
        error: null,
        result: {
          reason: "active_goal_limit"
        }
      });
    }
  } else {
    return steps;
  }

  const activeGoalsAfterCreate = await runStep(client, session, steps, { id: "6v", name: "list_goals", payload: { filter: "active" } });
  directGoalCreated =
    directGoalCreated &&
    Array.isArray(activeGoalsAfterCreate.result?.goals) &&
    activeGoalsAfterCreate.result.goals.some((goal) => goal?.title === directGoalTitle);
  lifestormGoalCreated =
    lifestormGoalCreated &&
    Array.isArray(activeGoalsAfterCreate.result?.goals) &&
    activeGoalsAfterCreate.result.goals.some((goal) => goal?.title === lifestormGoalTitle);

  chatGoalTitle = lifestormGoalCreated ? lifestormGoalTitle : (directGoalCreated ? directGoalTitle : workingGoalTitle);
  lifecycleGoalTitle = directGoalCreated ? directGoalTitle : chatGoalTitle;
  const safeTaskGoal =
    (await findActiveGoalByState(client, session, "tasks_present", (goal) => typeof goal?.title === "string" && goal.title.includes("MVP Automation Goal"))) ??
    (await findActiveGoalByState(client, session, "tasks_present")) ??
    (await findActiveGoalByState(client, session, "add_tasks", (goal) => typeof goal?.title === "string" && goal.title.includes("MVP Automation Goal"))) ??
    (await findActiveGoalByState(client, session, "add_tasks"));
  taskGoalTitle = safeTaskGoal?.title ?? lifecycleGoalTitle;

  const directGoalStart = await runStep(client, session, steps, { id: "7", name: "start_goal", payload: { goalTitle: chatGoalTitle } });
  if (!directGoalStart.ok) {
    return steps;
  }
  const goalChatA = await runStep(client, session, steps, { id: "7a", name: "talk_to_goal_chat", payload: { goalTitle: chatGoalTitle, message: goalMessageA } });
  const goalChatB = await runStep(client, session, steps, { id: "7b", name: "talk_to_goal_chat", payload: { goalTitle: chatGoalTitle, message: goalMessageB } });
  if (!goalChatA.ok || !goalChatB.ok) {
    return steps;
  }
  const goalChatReadA = await runStep(client, session, steps, { id: "7c", name: "read_goal_chat", payload: { goalTitle: chatGoalTitle } });
  await runStep(client, session, steps, { id: "7d", name: "read_goals_overview" });
  await runStep(client, session, steps, { id: "7e", name: "start_goal", payload: { goalTitle: chatGoalTitle } });
  const goalChatReadB = await runStep(client, session, steps, { id: "7f", name: "read_goal_chat", payload: { goalTitle: chatGoalTitle } });
  steps.push({
    step: "goal_chat_persistence",
    id: "7g",
    ok:
      Array.isArray(goalChatReadA.result?.messages) &&
      Array.isArray(goalChatReadB.result?.messages) &&
      goalChatReadA.result.messages.length > 0 &&
      goalChatReadB.result.messages.length >= goalChatReadA.result.messages.length,
    error: null,
    result: {
      firstReadCount: Array.isArray(goalChatReadA.result?.messages) ? goalChatReadA.result.messages.length : 0,
      secondReadCount: Array.isArray(goalChatReadB.result?.messages) ? goalChatReadB.result.messages.length : 0,
      bodyContainsSentMessages: await waitForBodyIncludes(client, [goalMessageA, goalMessageB], 2000).catch(() => false)
    }
  });

  const statusRead = await runStep(client, session, steps, { id: "8", name: "read_goal_status_details", payload: { goalTitle: chatGoalTitle } });
  steps.push({
    step: "goal_status_verify",
    id: "8v",
    ok:
      Array.isArray(statusRead.result?.details) &&
      statusRead.result.details.length === 6 &&
      statusRead.result.details.every((detail) => typeof detail.tooltip === "string"),
    error: null,
    result: {
      detailCount: Array.isArray(statusRead.result?.details) ? statusRead.result.details.length : 0
    }
  });

  const suggestionGoal = (await findActiveGoalByState(client, session, "add_tasks")) ?? (await findActiveGoalByState(client, session, "tasks_present"));
  if (suggestionGoal?.title) {
    const suggestionsRead = await runStep(client, session, steps, {
      id: "9",
      name: "read_task_suggestions",
      payload: { goalTitle: suggestionGoal.title }
    });
    const suggestions = Array.isArray(suggestionsRead.result?.suggestions) ? suggestionsRead.result.suggestions.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
    if (suggestions.length > 0) {
      const pick = suggestions.slice(0, 2);
      await runStep(client, session, steps, {
        id: "9a",
        name: "add_tasks",
        payload: { goalTitle: suggestionGoal.title, tasks: pick, useSuggestions: true }
      });
    }
  }

  const followup = [
    { id: "10", name: "start_goal", payload: { goalTitle: taskGoalTitle } },
    { id: "11", name: "add_tasks", payload: { goalTitle: taskGoalTitle, tasks: [workingTaskText] } }
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
    { id: "12", name: "complete_task", payload: { goalTitle: taskGoalTitle, taskText: workingTaskText } },
    { id: "13", name: "uncomplete_task", payload: { goalTitle: taskGoalTitle, taskText: workingTaskText } },
    { id: "14", name: "remove_task", payload: { goalTitle: taskGoalTitle, taskText: workingTaskText } },
    { id: "15", name: "update_goal", payload: { goalTitle: lifecycleGoalTitle, status: "completed" } },
    { id: "16", name: "update_goal", payload: { goalTitle: lifecycleGoalTitle, status: "active" } }
  ];

  for (const step of tail) {
    const res = await client.execute(step, session);
    steps.push({ step: step.name, ...summarize(res) });
    if (!res.ok) {
      break;
    }
  }

  if (directGoalCreated) {
    const archiveDirect = await client.execute({ id: "17", name: "update_goal", payload: { goalTitle: directGoalTitle, status: "archived" } }, session);
    steps.push({ step: "archive_direct_goal_cleanup", ...summarize(archiveDirect) });
  }
  if (lifestormGoalCreated) {
    const archiveLifestorm = await client.execute({ id: "18", name: "update_goal", payload: { goalTitle: lifestormGoalTitle, status: "archived" } }, session);
    steps.push({ step: "archive_lifestorm_goal_cleanup", ...summarize(archiveLifestorm) });
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

async function inspectCurrentPageText(page) {
  return page.locator("body").innerText().catch(() => "");
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
    if (!/selfmax\.ai|api/i.test(url)) return;
    events.push({
      type: "request",
      method: request.method(),
      url,
      postData: request.postData() ? request.postData().slice(0, 4000) : undefined
    });
  };
  const onResponse = async (response) => {
    const url = response.url();
    if (!/selfmax\.ai|api/i.test(url)) return;
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

async function captureContextNetwork(context, fn) {
  const events = [];
  const onRequest = (request) => {
    const url = request.url();
    if (!/selfmax\.ai|api/i.test(url)) return;
    events.push({
      type: "request",
      method: request.method(),
      url,
      postData: request.postData() ? request.postData().slice(0, 4000) : undefined
    });
  };
  const onResponse = async (response) => {
    const url = response.url();
    if (!/selfmax\.ai|api/i.test(url)) return;
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
  context.on("request", onRequest);
  context.on("response", onResponse);
  try {
    const result = await fn();
    return { result, events };
  } finally {
    context.off("request", onRequest);
    context.off("response", onResponse);
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

async function openGoalWorkspaceStatus(client, session, goalTitle, goalId) {
  await ensureLoggedIn(client, session);
  const started = await client.execute(
    { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle, goalId } },
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
      const res = await client.execute({ id: "archive", name: "update_goal", payload: { goalTitle: args.goalTitle ?? "", status: "archived" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "complete-by-id") {
      const res = await client.execute({ id: "complete", name: "update_goal", payload: { goalTitle: args.goalTitle ?? "", status: "completed" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "complete-goal") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "complete-goal", name: "update_goal", payload: { goalTitle: args.goalTitle ?? "", status: "completed" } }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "reactivate-goal") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "reactivate-goal", name: "update_goal", payload: { goalTitle: args.goalTitle ?? "", status: "active" } }, session);
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
        { id: "read-goal", name: "read_goal_full", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal-metadata") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-metadata", name: "read_goal_full", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal-workspace") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-workspace", name: "read_goal_full", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
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
      const res = await client.execute({ id: "read-cached-goals", name: "list_goals", payload: { filter: "all" } }, session);
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
          name: "read_goal_full",
          payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" }
        },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "survey-active-goal-task-states") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "survey-active-goal-task-states", name: "list_goals", payload: { filter: "active" } }, session);
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
      const res = await client.execute({ id: "list-desires", name: "read_lifestorming_overview" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-desire-category") {
      throw new Error("read-desire-category removed; use read-sensation-practice or read-lifestorming-overview");
    }

    if (args.mode === "read-lifestorming-full") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-lifestorming-full", name: "read_lifestorming_overview" }, session);
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

    if (args.mode === "feel-out-desires") {
      await ensureLoggedIn(client, session);
      const title = args.desireTitle ?? "";
      if (!title) {
        throw new Error("feel-out-desires requires --desire-title");
      }
      const res = await client.execute(
        {
          id: "feel-out-desires",
          name: "feel_out_desires",
          payload: { desires: [{ title, notes: args.message ?? `Reflection for ${title}` }] }
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
        inputs: await page.evaluate(() =>
          Array.from(document.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']"))
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role") || "",
              placeholder: el.getAttribute("placeholder") || "",
              value: "value" in el ? String(el.value ?? "") : ((el.textContent || "").trim()),
              className: (el.getAttribute("class") || "").slice(0, 300)
            }))
        ),
        snippet: await page.locator("body").innerText().catch(() => "")
      }));
      return;
    }

    if (args.mode === "task-suggestions-inspect") {
      const goalTitleToInspect = args.goalTitle ?? "";
      if (!goalTitleToInspect) {
        throw new Error("task-suggestions-inspect requires --goal-title");
      }
      await ensureLoggedIn(client, session);
      await client.execute(
        { id: "inspect-open-goal", name: "start_goal", payload: { goalTitle: goalTitleToInspect } },
        session
      );
      const page = client.page ?? client["page"];
      if (!page) throw new Error("page unavailable");
      await page.getByText(/Use the task suggestion tool/i).first().click().catch(() => undefined);
      await page.waitForTimeout(800);
      console.log(JSON.stringify({
        text: await inspectCurrentPageText(page),
        buttons: await inspectCurrentPageButtons(page),
        roles: await inspectCurrentPageRoles(page)
      }));
      return;
    }

    if (args.mode === "lifestorming-desire-inspect") {
      const title = args.desireTitle ?? "";
      if (!title) {
        throw new Error("lifestorming-desire-inspect requires --desire-title");
      }
      await ensureLoggedIn(client, session);
      const page = client.page ?? client["page"];
      if (!page) throw new Error("page unavailable");
      await page.goto("https://www.selfmax.ai/lifestorming", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const output = await page.evaluate((needle) => {
        const normalize = (value) => value.replace(/\s+/g, " ").trim();
        const row = Array.from(document.querySelectorAll("ul li, ol li"))
          .find((el) => normalize(el.textContent || "").includes(needle) && /GO|VIEW|OPEN/i.test(normalize(el.textContent || "")));
        const matches = Array.from(document.querySelectorAll("body *"))
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: normalize(el.textContent || ""),
            href: el instanceof HTMLAnchorElement ? el.href : "",
            role: el.getAttribute("role") || "",
            className: (el.getAttribute("class") || "").slice(0, 200)
          }))
          .filter((item) => item.text && item.text.includes(needle))
          .slice(0, 40);
        return {
          bodyText: normalize(document.body.innerText || ""),
          matches,
          rowHtml: row ? row.outerHTML.slice(0, 4000) : null,
          rowActions: row
            ? Array.from(row.querySelectorAll("*")).map((el) => ({
                tag: el.tagName.toLowerCase(),
                text: normalize(el.textContent || ""),
                role: el.getAttribute("role") || "",
                href: el instanceof HTMLAnchorElement ? el.href : "",
                className: (el.getAttribute("class") || "").slice(0, 200)
              })).filter((item) => item.text).slice(0, 40)
            : []
        };
      }, title);
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "sensation-practice-inspect") {
      const title = args.desireTitle ?? "";
      if (!title) {
        throw new Error("sensation-practice-inspect requires --desire-title");
      }
      await ensureLoggedIn(client, session);
      await client.execute(
        {
          id: "read-sensation-practice",
          name: "read_sensation_practice",
          payload: { desireId: args.desireId ?? "", desireTitle: title }
        },
        session
      );
      const page = client.page ?? client["page"];
      if (!page) throw new Error("page unavailable");
      console.log(JSON.stringify({
        url: page.url(),
        text: await inspectCurrentPageText(page),
        buttons: await inspectCurrentPageButtons(page),
        roles: await inspectCurrentPageRoles(page),
        inputs: await page.evaluate(() =>
          Array.from(document.querySelectorAll("textarea, input, [contenteditable='true']"))
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              value: "value" in el ? el.value : el.textContent || "",
              placeholder: el.getAttribute("placeholder") || "",
              className: (el.getAttribute("class") || "").slice(0, 200)
            }))
        )
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
        name: "update_goal",
        payload: { goalTitle: goalTitleToUse, status: "archived" }
      });
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "probe-complete-goal-network") {
      const goalTitleToUse = args.goalTitle ?? "";
      if (!goalTitleToUse) {
        throw new Error("probe-complete-goal-network requires --goal-title");
      }
      const output = await capturePrimitiveNetwork(client, session, {
        id: "probe-complete-goal-network",
        name: "update_goal",
        payload: { goalTitle: goalTitleToUse, status: "completed" }
      });
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "probe-sensation-save-network") {
      const title = args.desireTitle ?? "";
      if (!title) {
        throw new Error("probe-sensation-save-network requires --desire-title");
      }
      await ensureLoggedIn(client, session);
      const context = client.context ?? client["context"];
      if (!context) throw new Error("context unavailable");
      const output = await captureContextNetwork(context, async () => {
        const res = await client.execute(
          {
            id: "read-sensation-practice",
            name: "read_sensation_practice",
            payload: { desireId: args.desireId ?? "", desireTitle: title }
          },
          session
        );
        if (!res.ok) throw new Error(res.error ?? "could not open sensation practice");
        const page = client.page ?? client["page"];
        if (!page) throw new Error("page unavailable");
        const textarea = page.locator("textarea").first();
        await textarea.fill(args.message ?? `Probe reflection ${new Date().toISOString()}`);
        await page.getByText(/^SAVE$/i).first().click();
        await page.waitForTimeout(1500);
        return { url: page.url() };
      });
      console.log(JSON.stringify(output));
      return;
    }

    if (args.mode === "probe-sensation-direct-save-network") {
      const desireIdToUse = args.desireId ?? "";
      if (!desireIdToUse) {
        throw new Error("probe-sensation-direct-save-network requires --desire-id");
      }
      await ensureLoggedIn(client, session);
      const context = client.context ?? client["context"];
      const page = client.page ?? client["page"];
      if (!context || !page) throw new Error("context unavailable");
      const output = await captureContextNetwork(context, async () => {
        await page.goto(`https://www.selfmax.ai/lifestorming/sensation-practice/${encodeURIComponent(desireIdToUse)}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1000);
        const textarea = page.locator("textarea").first();
        await textarea.fill(args.message ?? `Probe reflection ${new Date().toISOString()}`);
        await page.getByText(/^SAVE$/i).first().click();
        await page.waitForTimeout(1500);
        return { url: page.url(), text: await page.locator("body").innerText().catch(() => "") };
      });
      console.log(JSON.stringify(output));
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

    if (args.mode === "read-understand-overview") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-understand-overview", name: "read_understand_overview" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-level-check") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-level-check", name: "read_level_check" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-life-history-assessment") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-life-history-assessment", name: "read_life_history_assessment" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-big-five-assessment") {
      await ensureLoggedIn(client, session);
      const res = await client.execute({ id: "read-big-five-assessment", name: "read_big_five_assessment" }, session);
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-goal-status") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-goal-status", name: "read_goal_status_details", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
        session
      );
      console.log(JSON.stringify(summarize(res)));
      return;
    }

    if (args.mode === "read-task-suggestions") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        { id: "read-task-suggestions", name: "read_task_suggestions", payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "" } },
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

    if (args.mode === "update-goal-due-date") {
      await ensureLoggedIn(client, session);
      const res = await client.execute(
        {
          id: "update-goal-due-date",
          name: "update_goal_due_date",
          payload: { goalId: args.goalId ?? "", goalTitle: args.goalTitle ?? "", dueDate: args.dueDate ?? nextIsoDate(14) }
        },
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
        "  examples: read_goals_overview, read_goal_full, read_page_sections, discover_links",
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
  const dueDate = args.dueDate ?? nextIsoDate(7);
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const create = await client.execute(
      { id: "2", name: "create_goal", payload: { title: goalTitle, category: "Meaning", dueDate } },
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

async function runUpdateGoalDueDate(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  const dueDate = args.dueDate ?? nextIsoDate(14);
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const update = await client.execute(
      {
        id: "2",
        name: "update_goal_due_date",
        payload: {
          goalId: args.goalId ?? "",
          goalTitle: args.goalTitle ?? "",
          dueDate
        }
      },
      session
    );
    console.log(JSON.stringify({ login: summarize(login), update: summarize(update) }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runPrimitiveOnce(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  const primitiveName = args.name ?? "";
  if (!primitiveName) {
    throw new Error("primitive mode requires --name");
  }
  let payload = {};
  if (args.payloadJson?.trim()) {
    payload = JSON.parse(args.payloadJson);
  }
  try {
    await client.init();
    const login = await client.execute({ id: "1", name: "login" }, session);
    const result = await client.execute({ id: "2", name: primitiveName, payload }, session);
    console.log(JSON.stringify({ login: summarize(login), result: summarize(result) }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runCreateGoalSubmitProbe(args) {
  const { SelfMaxPlaywrightClient } = await import("../dist/selfmaxClient.js");
  const client = new SelfMaxPlaywrightClient();
  const session = { sessionId: "smoke-session", userId: "smoke-user" };
  const goalTitle = args.goalTitle ?? `Probe Goal ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dueDate = args.dueDate ?? nextIsoDate(7);
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
      if (!/goal|selfmax|api/i.test(url)) return;
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
      if (!/goal|selfmax|api/i.test(url)) return;
      network.push({ type: "failed", url, method: req.method(), failure: req.failure()?.errorText ?? "unknown" });
    });

    await page.goto("https://www.selfmax.ai/goals", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /NEW GOAL/i }).first().click();
    await page.locator('textarea[placeholder*="E.g." i]').first().fill(goalTitle);
    await page.getByText(/^Meaning$/i).last().click();
    const dueInput = page.locator('input[type="date"]').first();
    if ((await dueInput.count()) > 0) {
      await dueInput.fill(dueDate);
    }
    await page.getByRole("button", { name: /^Create Goal$/i }).click();
    await page.waitForTimeout(2500);

    const snapshot = await page.evaluate(() => ({
      url: location.href,
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1400)
    }));
    console.log(JSON.stringify({ login: summarize(login), goalTitle, dueDate, createPost, network: network.slice(-30), snapshot }));
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
        "  read-understand-overview Read self-awareness hub cards/activity",
        "  read-level-check   Read level-check overview/topics",
        "  read-life-history-assessment Read life-history assessment state",
        "  read-big-five-assessment Read big-five assessment state",
        "  read-lifestorming-overview Read lifestorming landing overview",
        "  list-desires       Read lifestorming desire buckets/items",
        "  read-desire-category Read a single lifestorming category panel",
        "  keep-open          Login once and keep browser/session open",
        "  goals-list         Login + list goals (and discovered goalIds)",
        "  signin-diagnostic  Run direct /auth sign-in diagnostic",
        "  goals-inspect      Dump action/link snapshot from /goals",
        "  create-goal-inspect Inspect create-goal UI after pressing NEW GOAL",
        "  create-goal-primitive-inspect Run create_goal primitive and dump resulting UI state",
        "  create-goal-submit-probe Raw create-goal submit + network probe",
        "  update-goal-due-date Update an existing goal due date by title or id",
        "  primitive          Run one primitive once with explicit JSON payload",
        "",
        "Options:",
        "  --goal-title <title>   Goal title for sequence mode",
        "  --goal-id <id>         Goal id for *-by-id modes",
        "  --name <primitive>     Primitive name for primitive mode",
        "  --payload-json <json>  JSON payload for primitive mode",
        "  --due-date <yyyy-mm-dd> Due date for create/update goal modes",
        "  --wait-ms <n>          Extra wait for discovery-style reads",
        "  --task <task>          Task text for sequence mode",
        "  --message <message>    Chat message for guide step",
        "",
        "Examples:",
        "  node scripts/selfmax-smoke.mjs login",
        "  node scripts/selfmax-smoke.mjs goals-list",
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
        "  node scripts/selfmax-smoke.mjs create-goal-submit-probe",
        "  node scripts/selfmax-smoke.mjs update-goal-due-date --goal-title \"go rock climbing\" --due-date 2026-03-15",
        "  node scripts/selfmax-smoke.mjs primitive --name create_goal --payload-json '{\"title\":\"x\",\"category\":\"Meaning\",\"dueDate\":\"2026-03-15\"}'"
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

  if (args.mode === "update-goal-due-date") {
    await runUpdateGoalDueDate(args);
    return;
  }

  if (args.mode === "primitive") {
    await runPrimitiveOnce(args);
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
