# OpenClaw <-> SelfMax Bridge

This project provides a Playwright-driven integration layer so OpenClaw/Moltbot can treat `selfmax.ai` like an API-backed service.

## What it provides

- Public API endpoints exposed over a local-only WebSocket `type: "api"`:
  - `get_state`
  - `get_goals`
  - `get_goal`
  - `get_goal_tasks`
  - `get_goal_chat`
  - `get_desires`
  - `get_desire`
  - `get_actions`
  - `talk_to_guide`
  - `talk_to_goal_chat`
  - `add_desires`
  - `update_desires`
  - `create_goals_from_desires`
  - `create_goal`
  - `update_goal`
  - `update_tasks`
- Atomic primitive execution (serialized task queue).
- Local single-user Playwright session reuse for boringly reliable beta testing.
- State persistence in SelfMax browser storage (keyed by user/session).

Internal Playwright primitives still exist for local smoke/dev tooling, but they are private implementation details and are not part of the external contract.

## Source Layout

The source tree is organized by responsibility:

- `src/core`
  - shared config, schemas, types, recovery, and atomic execution
- `src/platform`
  - route catalog, selectors, navigation, DOM extractors, diagnostics
- `src/features`
  - `auth`
  - `goals`
  - `lifestorming`
- `src/api`
  - public API adapter
  - private primitive handler wiring
- `src/client`
  - long-lived Playwright client and session/cache orchestration
- `src/bridge`
  - local-only WebSocket server and API exposure

Barrel files are used at the feature and boundary folders where they improve imports:

- `src/api/index.ts`
- `src/bridge/index.ts`
- `src/client/index.ts`
- `src/features/auth/index.ts`
- `src/features/goals/index.ts`
- `src/features/lifestorming/index.ts`

## Run

1. Install deps:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Start dev server:

```bash
npm run dev
```

## Smoke tests

Build first:

```bash
npm run build
```

Then run one of:

```bash
npm run smoke:login
npm run smoke:probe
npm run smoke:public
npm run smoke:sequence
npm run smoke:keep-open
npm run smoke:signin
node scripts/selfmax-smoke.mjs goals-list
node scripts/selfmax-smoke.mjs read-current-route
node scripts/selfmax-smoke.mjs read-known-routes
node scripts/selfmax-smoke.mjs discover-goals
node scripts/selfmax-smoke.mjs read-auth-state
node scripts/selfmax-smoke.mjs read-goals-overview
node scripts/selfmax-smoke.mjs route-snapshot --route goals
node scripts/selfmax-smoke.mjs read-page-sections --route help
node scripts/selfmax-smoke.mjs discover-links --route map
node scripts/selfmax-smoke.mjs read-goal-full --goal-title "MVP Automation Goal"
node scripts/selfmax-smoke.mjs read-cached-desires
node scripts/selfmax-smoke.mjs read-tasks --goal-title "MVP Automation Goal"
node scripts/selfmax-smoke.mjs read-goal-chat --goal-title "MVP Automation Goal"
node scripts/selfmax-smoke.mjs read-lifestorming-overview
node scripts/selfmax-smoke.mjs read-sensation-practice --desire-id <desire-id>
node scripts/selfmax-smoke.mjs update-goal-due-date --goal-title "go rock climbing" --due-date 2026-03-15
```

`npm run smoke:public` verifies only the public API adapter surface. It avoids private primitives so contract hardening stays focused on the real external interface.

Goal creation requires explicit inputs:
- `create_goal` requires `title`, `category`, and `dueDate`
- `create_goals_from_desires` requires each entry to include a due date
- for `create_goals_from_desires`, the desire is indexed by `title`
- resulting goal title defaults to `title`, with optional `goalTitle` override
- resulting goal category defaults to cached desire category, with optional `goalCategory` override
- optional overrides are supported with `goalTitle` and `goalCategory`
- the API layer should not assume a default category or due date

Goal updates:
- public goal mutation should use `update_goal`
- `update_goal` requires `goalTitle` and at least one of:
  - `status`: `active` | `completed` | `archived`
  - `dueDate`: `YYYY-MM-DD`
- primary due-date path: `/goals` inline due-date editor from the visible `Due ...` label
- due-date updates are UI-only and must satisfy visible postconditions on `/goals`
- legacy goal-specific mutation primitives still exist internally, but `update_goal` is the preferred public contract

`smoke:keep-open` logs in once and keeps the browser open for repeated rounds. This is internal development tooling, not the external API:

```text
sequence
primitive talk_to_guide {"message":"help me prioritize today"}
primitive read_goals_overview {}
primitive read_page_sections {"route":"help"}
primitive discover_links {"route":"map"}
primitive start_goal {"goalTitle":"MVP Automation Goal"}
exit
```

## WebSocket protocol

This bridge is local-only in the current beta phase:

- loopback connections only
- `type: "api"` is the only supported external contract
- chat/message passthrough is disabled

API request example:

```json
{
  "type": "api",
  "role": "openclaw",
  "correlationId": "req-1",
  "payload": {
    "id": "req-1",
    "name": "get_actions",
    "payload": {}
  }
}
```

Add desires example:

```json
{
  "type": "api",
  "role": "openclaw",
  "correlationId": "req-2",
  "payload": {
    "id": "req-2",
    "name": "add_desires",
    "payload": {
      "itemsByCategory": {
        "Health": ["Get healthy", "Sleep better"],
        "Work": ["Ship one meaningful project this quarter"]
      }
    }
  }
}
```

Update desires example:

```json
{
  "type": "api",
  "role": "openclaw",
  "correlationId": "req-update-desires",
  "payload": {
    "id": "req-update-desires",
    "name": "update_desires",
    "payload": {
      "desires": [
        {
          "title": "Learn to love",
          "notes": "Feels meaningful, vulnerable, and worth exploring."
        }
      ]
    }
  }
}
```

Goal chat example:

```json
{
  "type": "api",
  "role": "openclaw",
  "correlationId": "req-goal-chat",
  "payload": {
    "id": "req-goal-chat",
    "name": "talk_to_goal_chat",
    "payload": {
      "goalTitle": "start a family",
      "message": "Help me pick the highest-leverage next step."
    }
  }
}
```

Update goal example:

```json
{
  "type": "api",
  "role": "openclaw",
  "correlationId": "req-update-goal",
  "payload": {
    "id": "req-update-goal",
    "name": "update_goal",
    "payload": {
      "goalTitle": "start a family",
      "status": "archived",
      "dueDate": "2026-03-15"
    }
  }
}
```

Update tasks example:

```json
{
  "type": "api",
  "role": "openclaw",
  "correlationId": "req-update-tasks",
  "payload": {
    "id": "req-update-tasks",
    "name": "update_tasks",
    "payload": {
      "goalTitle": "start a family",
      "updates": [
        { "task": "Call the specialist", "action": "add" },
        { "task": "Review insurance options", "action": "complete" }
      ]
    }
  }
}
```

## Important notes

- SelfMax selectors are configurable via env vars because the DOM may change.
- Current state persistence is implemented with `window.localStorage` inside the authenticated SelfMax session context.
- For production durability, replace storage primitives with explicit SelfMax UI actions that write/read from a durable in-app entity (notes/journal/custom field).
- The external contract is the public API carried in WebSocket envelopes with `type: "api"`.
- Internal primitives, diagnostics, navigation helpers, and operational controls are private implementation details.
- The development smoke scripts exercise the private primitive layer directly and are not part of the external contract.
- Canonical route/state/action definitions are documented in `docs/selfmax-route-state-action-spec.md`.
- Canonical guidance language inventory is documented in `docs/selfmax-guidance-copy-inventory.md`.
- Canonical integration runtime flow is documented in `docs/selfmax-technical-integration-flow.md`.
