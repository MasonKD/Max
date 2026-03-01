#!/usr/bin/env node

import { PublicApi } from "../dist/api/index.js";
import { SelfMaxPlaywrightClient } from "../dist/client/index.js";

function summarize(step, response) {
  return {
    step,
    ok: response.ok,
    error: response.error ?? null,
    result: response.result ?? null
  };
}

async function run(publicApi, session, request) {
  const response = await publicApi.execute(request, session);
  return summarize(request.name, response);
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

async function main() {
  const fullSweep = process.argv.includes("--full");
  const reads = process.argv.includes("--reads");
  const sequence = process.argv.includes("--sequence");
  const client = new SelfMaxPlaywrightClient();
  const publicApi = new PublicApi(client);
  const session = { sessionId: "public-smoke-session", userId: "public-smoke-user" };

  try {
    await client.init();

    const requests = [
      { id: "1", name: "get_actions", payload: {} },
      { id: "2", name: "get_goals", payload: { status: "active", deep: false } },
      { id: "3", name: "get_desires", payload: { deep: false } }
    ];

    if (fullSweep) {
      requests.push({ id: "4", name: "get_state", payload: { includeArchived: false } });
    }

    if (sequence) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      requests.push(
        { id: "10", name: "talk_to_guide", payload: { message: `Public API smoke guide check ${stamp}` } },
        {
          id: "11",
          name: "create_goal",
          payload: { title: `Public API Smoke Goal ${stamp}`, category: "Meaning", dueDate: "2026-03-15" }
        },
        {
          id: "12",
          name: "talk_to_goal_chat",
          payload: { goalTitle: `Public API Smoke Goal ${stamp}`, message: `Public API smoke goal chat ${stamp}` }
        },
        {
          id: "13",
          name: "update_tasks",
          payload: {
            goalTitle: `Public API Smoke Goal ${stamp}`,
            updates: [{ task: `Public API Smoke Task ${stamp}`, action: "add" }]
          }
        },
        {
          id: "14",
          name: "update_goal",
          payload: { goalTitle: `Public API Smoke Goal ${stamp}`, status: "archived" }
        }
      );
    }

    const results = [];
    for (const request of requests) {
      const result = await run(publicApi, session, request);
      results.push(result);
      console.log(JSON.stringify(result));
    }

    if (reads) {
      const goals = results.find((result) => result.step === "get_goals")?.result;
      const desires = results.find((result) => result.step === "get_desires")?.result;
      const firstGoalTitle = goals?.goals?.find((goal) => typeof goal?.title === "string" && goal.title.trim().length > 0)?.title;
      const firstDesireTitle = desires?.desires?.find((desire) => typeof desire?.title === "string" && desire.title.trim().length > 0)?.title;

      const followUps = [];
      if (firstGoalTitle) {
        followUps.push(
          { id: "20", name: "get_goal", payload: { goalTitle: firstGoalTitle, depth: 0 } },
          { id: "21", name: "get_goal_tasks", payload: { goalTitle: firstGoalTitle } },
          { id: "22", name: "get_goal_chat", payload: { goalTitle: firstGoalTitle, depth: 0 } }
        );
      }
      if (firstDesireTitle) {
        followUps.push({ id: "23", name: "get_desire", payload: { desireTitle: firstDesireTitle } });
      }
      followUps.push({ id: "24", name: "get_state", payload: { includeArchived: false } });

      const followUpResults = await mapWithConcurrency(followUps, 4, (request) => run(publicApi, session, request));
      for (const result of followUpResults) {
        console.log(JSON.stringify(result));
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
