# OpenClaw <-> SelfMax Bridge

This project provides a Playwright-driven integration layer so OpenClaw/Moltbot can treat `selfmax.ai` like an API-backed service.

## What it provides

- API-like primitives executed against the SelfMax web app:
  - `login`
  - `get_state`
  - `set_state`
  - `send_coach_message`
  - `read_coach_messages`
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

## Important notes

- SelfMax selectors are configurable via env vars because the DOM may change.
- Current state persistence is implemented with `window.localStorage` inside the authenticated SelfMax session context.
- For production durability, replace storage primitives with explicit SelfMax UI actions that write/read from a durable in-app entity (notes/journal/custom field).
- A first-pass state/action inventory is documented in `docs/state-action-catalog.md` and mapped to stable `actionId` values.
