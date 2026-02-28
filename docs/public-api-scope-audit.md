# Public API Scope Audit

This document defines what is in scope for reliability hardening.

The only external contract is the public API carried in WebSocket envelopes with `type: "api"`.

## In Scope

Public endpoints:

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

Internal primitives currently used by the public API adapter:

- `login`
- `read_coach_messages`
- `read_goal_chat`
- `read_goal_full`
- `read_goal_status_details`
- `list_goals`
- `list_goal_tasks`
- `read_lifestorming_overview`
- `read_cached_desires`
- `read_sensation_practice`
- `talk_to_guide`
- `talk_to_goal_chat`
- `brainstorm_desires_for_each_category`
- `feel_out_desires`
- `create_goals_from_desires`
- `create_goal`
- `update_goal`
- `add_tasks`
- `complete_task`
- `uncomplete_task`
- `remove_task`

Feature modules currently in scope because they back the public API:

- `src/features/auth`
- `src/features/goals`
- `src/features/lifestorming`
- `src/api/publicApi.ts`
- `src/client/selfmaxClient.ts`

## Out Of Scope

These remain private dev/runtime support and should not drive reliability work unless an in-scope endpoint depends on them.

Private primitives retained because they still provide unique diagnostic or operator value:

- `read_auth_state`
- `read_current_route`
- `read_known_routes`
- `read_goals_overview`
- `read_route_snapshot`
- `read_page_sections`
- `discover_links`
- `discover_goals`
- `read_task_suggestions`
- `read_understand_overview`
- `read_level_check`
- `read_life_history_assessment`
- `read_big_five_assessment`
- `start_goal`

Private primitives removed because they duplicated in-scope behavior or added no unique value:

- `set_state`
- `send_coach_message`
- `read_goal`
- `read_goal_metadata`
- `read_goal_workspace`
- `read_cached_goals`
- `read_task_panel_snapshot`
- `survey_active_goal_task_states`
- `list_lifestorming_desires`
- `read_lifestorming_category`
- `read_lifestorming_full`
- `navigate`
- `list_known_actions`
- `invoke_known_action`
- `delete_goal`
- `complete_goal`
- `reactivate_goal`
- `archive_goal`

Notes:

- These private primitives may still be useful for smoke/debug work.
- They are out of scope for “boringly reliable public API” hardening.
- They should not gain new surface area unless a public endpoint requires them.

## Current Consolidation Targets

These are the duplication points inside the in-scope path:

1. Goal summary mapping in `src/api/publicApi.ts`
- shallow and deep goal mapping both normalize title, category, due date, completion, and tasks

2. Goal-status list traversal in `src/api/publicApi.ts`
- `get_goals`, `get_goal`, and `get_state` all walk goal lists by status

3. Chat response extraction in `src/api/publicApi.ts`
- guide chat and goal chat both use the same before/after diff pattern

4. Desire reads in `src/api/publicApi.ts`
- `get_desires` and `get_desire` both reconstruct felt-out/category/sensation-practice state

## Hardening Rule

When deciding where to spend effort:

- first: public API behavior
- second: internal primitive behavior used by the public API
- last: private smoke/debug functionality
