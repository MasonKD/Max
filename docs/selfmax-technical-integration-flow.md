# SelfMax Technical Flow Chart

This document describes the runtime integration flow (OpenClaw <-> Bridge <-> Playwright <-> SelfMax UI).

## Components

- `OpenClaw/Moltbot`: orchestrator that decides next action.
- `BridgeServer` (WebSocket): message bus + primitive endpoint.
- `AtomicExecutor`: per-session mutation serialization.
- `SelfMaxPlaywrightClient`: UI automation driver.
- `SelfMax UI`: state source of truth.

## High-Level Flow

```mermaid
flowchart TD
  A[OpenClaw Connects WS] --> B[Bridge Registers Session role userId sessionId]
  B --> C[OpenClaw Sends Primitive]
  C --> D[Bridge Routes Primitive]
  D --> E[AtomicExecutor Queue]
  E --> F[Playwright Executes UI Action]
  F --> G[Read/Write SelfMax UI State]
  G --> H[Primitive Response ack/error]
  H --> I[Bridge Emits to OpenClaw]
  I --> C
```

## Primitive Execution Pipeline

```mermaid
flowchart LR
  P0[primitive request] --> P1[validate name + payload]
  P1 --> P2{mutating?}
  P2 -- yes --> P3[enqueue atomic task]
  P2 -- no --> P4[execute directly]
  P3 --> P5[ensure route/context]
  P4 --> P5
  P5 --> P6[playwright action/read]
  P6 --> P7[normalize result]
  P7 --> P8[ack or error envelope]
```

## Core Runtime Loop

1. OpenClaw sends `primitive` or `message`.
2. Bridge parses envelope and resolves session scope.
3. For `primitive`:
4. Execute via Playwright (`navigate`, `invoke_known_action`, `get_state`, etc.).
5. Return `ack`/`error` with `correlationId`.
6. OpenClaw decides next primitive from returned state.
7. Repeat until terminal condition (`signout`, session timeout, or external stop).

## Canonical Product Loop (Requested)

```mermaid
flowchart TD
  A[auth.signin_password] --> B[lifestorming.open]
  B --> C[lifestorming.brainstorm_desires]
  C --> D[lifestorming.add_desire_to_category]
  D --> E[lifestorming.feel_out_desire subset]
  E --> F[lifestorming.promote_desire_to_goal]
  F --> G[coach.send_message in goal chat]
  G --> H[tasks.create one or more]
  H --> I[tasks.complete]
  I --> J{all required tasks done?}
  J -- no --> G
  J -- yes --> K[goals.complete]
```

Action intent:
- `brainstorm`: generate/capture desire candidates.
- `add items to health/work/etc.`: categorize desires.
- `feel it out`: short validation pass before promoting desire to goal.
- `chat in goal window`: keep coaching thread goal-scoped.

## Anytime Interrupt Paths

At any point in the loop, caller may branch to one of these actions and then return to prior flow state:

```mermaid
flowchart LR
  X[current flow state] --> A[lifestorming.brainstorm_desires]
  X --> B[lifestorming.feel_out_desire]
  X --> C[lifestorming.promote_desire_to_goal]
  X --> D[goals.create direct]
  X --> E[coach.send_message goalId]
  X --> F[tasks.create or tasks.delete]
  X --> G[tasks.complete or tasks.uncomplete]
  X --> H[goals.start/archive/complete]
  A --> X
  B --> X
  C --> X
  D --> X
  E --> X
  F --> X
  G --> X
  H --> X
```

Execution rule:
- Integration auto-navigates to required page context, executes atomic action, then returns control to orchestrator.

## Message Passthrough Loop

```mermaid
sequenceDiagram
  participant U as End User
  participant B as BridgeServer
  participant O as OpenClaw
  participant S as SelfMax Bot UI

  U->>B: message(user_to_openclaw)
  B->>O: forward message
  O->>B: primitive(send_coach_message)
  B->>S: Playwright enters + sends
  S-->>B: UI response visible
  B->>O: ack + read_coach_messages result
  O->>B: message(openclaw_to_user)
  B->>U: forward message
```

## Error/Retry Branches

- Parse failure: return `error` with invalid envelope reason.
- Selector failure: return `error` + action ID + route context.
- Auth failure: trigger `navigate(auth)` and `login` retry path.
- Stale context: reload route, then retry once.
- Timeout: mark primitive failed, preserve session, allow caller retry.

## Minimal State Machine (Integration-Level)

```mermaid
stateDiagram-v2
  [*] --> Disconnected
  Disconnected --> Connected: ws connect
  Connected --> Ready: login/context ok
  Ready --> Executing: primitive received
  Executing --> Ready: ack
  Executing --> Ready: error recoverable
  Ready --> Degraded: repeated failures/timeouts
  Degraded --> Ready: successful health action
  Ready --> Disconnected: ws close
```

## Route Transition Graph (Simplified)

```mermaid
flowchart TD
  HOME[home] --> AUTH[auth/signin]
  AUTH --> GOALS[goals]
  GOALS --> SM[self-maximize]
  GOALS --> LS[lifestorming]
  LS --> LSD[desires-selection]
  LSD --> LSP[sensation-practice]
  GOALS --> UND[understand]
  GOALS --> MAP[map]
  GOALS --> COM[community]
  AUTH --> RESET[reset-password]
  AUTH --> HELP[help]
  HELP --> A1[assessment life-history]
  HELP --> A2[assessment big-five]
  GOALS --> LC[level-check]
```
