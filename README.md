# OpenClaw <-> SelfMax Bridge

This project provides a Playwright-driven integration layer so OpenClaw/Moltbot can treat `selfmax.ai` like an API-backed service.

## What it provides

- API-like primitives executed against the SelfMax web app:
  - `login`
  - `get_state`
  - `set_state`
  - `talk_to_guide`
  - `talk_to_goal_chat`
  - `send_coach_message` (legacy alias)
  - `read_coach_messages`
  - `brainstorm_desires_for_each_category`
  - `feel_out_desires`
  - `create_goals_from_desires`
  - `create_goal`
  - `read_auth_state`
  - `read_current_route`
  - `read_known_routes`
  - `read_goals_overview`
  - `read_route_snapshot`
  - `read_page_sections`
  - `discover_links`
  - `list_goals`
  - `discover_goals`
  - `discover_goal_ids`
  - `read_goal`
  - `read_goal_metadata`
  - `read_goal_workspace`
  - `read_goal_full`
  - `read_cached_goals`
  - `read_cached_desires`
  - `read_task_panel_snapshot`
  - `survey_active_goal_task_states`
  - `list_goal_tasks`
  - `read_goal_chat`
  - `read_lifestorming_overview`
  - `list_lifestorming_desires`
  - `read_lifestorming_category`
  - `read_lifestorming_full`
  - `read_sensation_practice`
  - `start_goal`
  - `add_tasks`
  - `remove_task`
  - `complete_task`
  - `uncomplete_task`
  - `complete_goal`
  - `archive_goal`
  - `delete_goal`
  - `delete_goal_api` (best-effort; requires exposed Firebase SDK in page context)
  - `navigate`
  - `list_known_actions`
  - `invoke_known_action`
- Atomic primitive execution (serialized task queue).
- Session-scoped message bridge for OpenClaw, SelfMax bot, and end-user over WebSocket.
- State persistence in SelfMax browser storage (keyed by user/session).

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
npm run smoke:sequence
npm run smoke:keep-open
npm run smoke:signin
node scripts/selfmax-smoke.mjs goals-list
node scripts/selfmax-smoke.mjs goals-discover-ids
node scripts/selfmax-smoke.mjs read-current-route
node scripts/selfmax-smoke.mjs read-known-routes
node scripts/selfmax-smoke.mjs discover-goals
node scripts/selfmax-smoke.mjs read-auth-state
node scripts/selfmax-smoke.mjs read-goals-overview
node scripts/selfmax-smoke.mjs route-snapshot --route goals
node scripts/selfmax-smoke.mjs read-page-sections --route help
node scripts/selfmax-smoke.mjs discover-links --route map
node scripts/selfmax-smoke.mjs read-goal --goal-id <id>
node scripts/selfmax-smoke.mjs read-goal-metadata --goal-id <id>
node scripts/selfmax-smoke.mjs read-goal-workspace --goal-id <id>
node scripts/selfmax-smoke.mjs read-goal-full --goal-id <id>
node scripts/selfmax-smoke.mjs read-cached-goals
node scripts/selfmax-smoke.mjs read-cached-desires
node scripts/selfmax-smoke.mjs read-task-panel-snapshot --goal-id <id>
node scripts/selfmax-smoke.mjs survey-active-goal-task-states
node scripts/selfmax-smoke.mjs read-tasks --goal-id <id>
node scripts/selfmax-smoke.mjs read-goal-chat --goal-id <id>
node scripts/selfmax-smoke.mjs read-lifestorming-overview
node scripts/selfmax-smoke.mjs list-desires
node scripts/selfmax-smoke.mjs read-desire-category --message Health
node scripts/selfmax-smoke.mjs read-lifestorming-full
node scripts/selfmax-smoke.mjs read-sensation-practice --desire-id <desire-id>
```

`smoke:keep-open` logs in once and keeps the browser open for repeated rounds:

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

Connect with query params:

- `role`: `openclaw` | `selfmax-bot` | `end-user`
- `userId`: user identifier
- `sessionId`: session identifier

Primitive request example:

```json
{
  "type": "primitive",
  "role": "openclaw",
  "correlationId": "req-1",
  "payload": {
    "id": "req-1",
    "name": "set_state",
    "payload": { "goal": "Run 5k", "status": "active" }
  }
}
```

Chat passthrough example:

```json
{
  "type": "message",
  "role": "end-user",
  "correlationId": "msg-1",
  "payload": { "text": "Check in on my goals today." }
}
```

Known action invocation example:

```json
{
  "type": "primitive",
  "role": "openclaw",
  "correlationId": "req-2",
  "payload": {
    "id": "req-2",
    "name": "invoke_known_action",
    "payload": {
      "actionId": "goals.send_guide_message",
      "message": "Help me prioritize today's top goal."
    }
  }
}
```

MVP primitive examples:

```json
{
  "type": "primitive",
  "role": "openclaw",
  "correlationId": "req-login",
  "payload": { "id": "req-login", "name": "login" }
}
```

```json
{
  "type": "primitive",
  "role": "openclaw",
  "correlationId": "req-brainstorm",
  "payload": {
    "id": "req-brainstorm",
    "name": "brainstorm_desires_for_each_category",
    "payload": {
      "itemsByCategory": {
        "health": ["Get healthy", "Sleep better"],
        "work": ["Ship one meaningful project this quarter"]
      }
    }
  }
}
```

```json
{
  "type": "primitive",
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

Goal lifecycle primitives accept `goalId` for deterministic targeting of existing goals:

```json
{
  "type": "primitive",
  "role": "openclaw",
  "correlationId": "req-start-id",
  "payload": {
    "id": "req-start-id",
    "name": "start_goal",
    "payload": { "goalId": "9JOUKBmhwNj11uj8IUTf" }
  }
}
```

## Important notes

- SelfMax selectors are configurable via env vars because the DOM may change.
- Current state persistence is implemented with `window.localStorage` inside the authenticated SelfMax session context.
- For production durability, replace storage primitives with explicit SelfMax UI actions that write/read from a durable in-app entity (notes/journal/custom field).
- Canonical route/state/action definitions are documented in `docs/selfmax-route-state-action-spec.md`.
- Canonical guidance language inventory is documented in `docs/selfmax-guidance-copy-inventory.md`.
- Canonical integration runtime flow is documented in `docs/selfmax-technical-integration-flow.md`.
