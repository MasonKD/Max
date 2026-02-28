#!/usr/bin/env node

import { PublicApi } from "../src/api/index.js";
import { SelfMaxPlaywrightClient } from "../src/client/index.js";
import type { PublicApiRequest, SessionContext } from "../src/core/types.js";

type StepResult = {
  step: string;
  ok: boolean;
  error: string | null;
  result: unknown;
};

function summarize(step: string, response: { ok: boolean; error?: string; result?: unknown }): StepResult {
  return {
    step,
    ok: response.ok,
    error: response.error ?? null,
    result: response.result ?? null
  };
}

async function run(publicApi: PublicApi, session: SessionContext, request: PublicApiRequest): Promise<StepResult> {
  const response = await publicApi.execute(request, session);
  return summarize(request.name, response);
}

async function main(): Promise<void> {
  const fullSweep = process.argv.includes("--full");
  const client = new SelfMaxPlaywrightClient();
  const publicApi = new PublicApi(client);
  const session = { sessionId: "public-smoke-session", userId: "public-smoke-user" };

  try {
    await client.init();

    const requests: PublicApiRequest[] = [
      { id: "1", name: "get_actions", payload: {} },
      { id: "2", name: "get_goals", payload: { status: "active", deep: false } },
      { id: "3", name: "get_desires", payload: { deep: false } }
    ];

    if (fullSweep) {
      requests.push({ id: "4", name: "get_state", payload: {} });
    }

    for (const request of requests) {
      console.log(JSON.stringify(await run(publicApi, session, request)));
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
