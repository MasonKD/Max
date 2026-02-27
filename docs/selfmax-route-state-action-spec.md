# SelfMax Integration States and Actions (Comprehensive Draft)

This file defines a complete first-pass state/action model for automating `selfmax.ai` via Playwright.
It is product-facing, not implementation-facing: names can be mapped to internal primitive IDs.

## 1) Route States

- `route.home`: `https://www.selfmax.ai`
- `route.auth_signin`: `https://www.selfmax.ai/auth?mode=sign-in&v=b`
- `route.auth_signup`: `https://www.selfmax.ai/auth?mode=sign-up&v=b`
- `route.legal`: `https://www.selfmax.ai/legal`
- `route.goals`: `https://www.selfmax.ai/goals`
- `route.self_maximize`: `https://www.selfmax.ai/self-maximize?goalId=[goalId]`
- `route.lifestorming`: `https://www.selfmax.ai/lifestorming`
- `route.lifestorming_desires_selection`: `https://www.selfmax.ai/lifestorming/desires-selection/[category]`
- `route.lifestorming_sensation_practice`: `https://www.selfmax.ai/lifestorming/sensation-practice/[desireId]`
- `route.understand`: `https://www.selfmax.ai/understand`
- `route.auth`: `https://www.selfmax.ai/auth`
- `route.home_legacy`: `https://www.selfmax.ai/home`
- `route.auth_signup_alt`: `https://www.selfmax.ai/auth?mode=sign-up`
- `route.help`: `https://www.selfmax.ai/help`
- `route.faq_v2`: `https://www.selfmax.ai/faq-v2`
- `route.terms_v2`: `https://www.selfmax.ai/terms-of-service-v2`
- `route.privacy_v2`: `https://www.selfmax.ai/privacy-policy-v2`
- `route.reset_password`: `https://www.selfmax.ai/reset-password`
- `route.community`: `https://www.selfmax.ai/community`
- `route.map`: `https://www.selfmax.ai/map`
- `route.assessment_life_history`: `https://www.selfmax.ai/assessments/life-history`
- `route.assessment_big_five`: `https://www.selfmax.ai/assessments/big-five`
- `route.level_check`: `https://www.selfmax.ai/level-check`

## 2) Application State Domains

### `state.auth`
- `isAuthenticated: boolean`
- `provider: "password" | "google" | null`
- `activeUserEmail: string | null`
- `authMode: "signin" | "signup" | null`

### `state.session`
- `sessionId: string`
- `userId: string`
- `connectedRoles: ("openclaw" | "selfmax-bot" | "end-user")[]`
- `lastHeartbeatAt: string | null`

### `state.navigation`
- `currentRoute: route.*`
- `lastRouteChangeAt: string | null`

### `state.ui`
- `isMoreMenuOpen: boolean`
- `isGoalListVisible: boolean`
- `selectedGoalCategory: "health" | "work" | "love" | "family" | "social" | "fun" | "dreams" | "meaning" | null`
- `draftCoachMessage: string`
- `lastUiError: string | null`

### `state.coach`
- `threadId: string | null`
- `messages: CoachMessage[]`
- `lastCoachResponseAt: string | null`

### `state.goals`
- `goals: Goal[]`
- `goalsByCategory: Record<string, Goal[]>`
- `activeGoalId: string | null`
- `lastGoalSyncAt: string | null`

### `state.tasks`
- `tasksByGoalId: Record<string, Task[]>`
- `activeTaskId: string | null`
- `lastTaskSyncAt: string | null`

### `state.selfMaximize`
- `goalId: string | null`
- `activeStepId: string | null`
- `sessionStatus: "idle" | "in_progress" | "completed" | "unknown"`
- `lastReflection: string | null`

### `state.lifestorming`
- `selectedCategory: string | null`
- `selectedDesireId: string | null`
- `practiceStepIndex: number | null`
- `practiceStatus: "idle" | "in_progress" | "completed" | "unknown"`

### `state.understand`
- `activeModuleId: string | null`
- `completedModuleIds: string[]`
- `lastUnderstandSyncAt: string | null`

### `state.help`
- `activeHelpTopicId: string | null`
- `helpSearchQuery: string`
- `lastHelpSyncAt: string | null`

### `state.legalDocs`
- `activeLegalDoc: "terms_v2" | "privacy_v2" | "faq_v2" | "legal" | null`
- `lastLegalDocSyncAt: string | null`

### `state.accountRecovery`
- `resetEmail: string | null`
- `resetRequestedAt: string | null`
- `resetRequestStatus: "idle" | "pending" | "sent" | "failed"`

### `state.community`
- `activeFeedTab: string | null`
- `visiblePostIds: string[]`
- `selectedPostId: string | null`

### `state.map`
- `activeMapNodeId: string | null`
- `expandedNodeIds: string[]`
- `lastMapSyncAt: string | null`

### `state.assessments`
- `activeAssessmentId: "life_history" | "big_five" | null`
- `assessmentProgress: number | null`
- `lastAssessmentSyncAt: string | null`

### `state.levelCheck`
- `lastLevelScore: number | null`
- `lastLevelBand: string | null`
- `lastLevelCheckAt: string | null`

### `state.integration`
- `lastPrimitive: string | null`
- `lastPrimitiveStatus: "ok" | "error" | null`
- `lastPrimitiveError: string | null`
- `selectorVersion: string | null`

## 3) Entity Shapes

### `Goal`
- `id: string`
- `title: string`
- `description: string | null`
- `category: "health" | "work" | "love" | "family" | "social" | "fun" | "dreams" | "meaning" | "unknown"`
- `status: "not_started" | "active" | "paused" | "completed" | "archived" | "unknown"`
- `progress: number | null`
- `createdAt: string | null`
- `updatedAt: string | null`

### `CoachMessage`
- `id: string`
- `role: "user" | "coach" | "system"`
- `text: string`
- `timestamp: string | null`

### `Task`
- `id: string`
- `goalId: string`
- `title: string`
- `description: string | null`
- `status: "todo" | "in_progress" | "completed" | "archived" | "unknown"`
- `dueAt: string | null`
- `createdAt: string | null`
- `updatedAt: string | null`

## 4) Global Non-Mutating Actions (Read-Only)

### `route.get_current`
- Description: read current URL and mapped route state.
- Input: none
- Output: `{ url, routeId }`

### `auth.get_status`
- Description: read authentication/session status from page context.
- Input: none
- Output: `{ isAuthenticated, activeUserEmail, provider }`

### `ui.get_visibility`
- Description: read visibility of menus/panels/toggles.
- Input: none
- Output: `{ isMoreMenuOpen, isGoalListVisible }`

### `goals.list`
- Description: list all visible goals.
- Input: optional filters `{ category?, status?, query? }`
- Output: `Goal[]`

### `goals.get`
- Description: get details for one goal.
- Input: `{ goalId }`
- Output: `Goal`

### `goals.list_categories`
- Description: list goal categories visible in UI.
- Input: none
- Output: `string[]`

### `self_maximize.get_goal_context`
- Description: read goal-linked self-maximize context from page.
- Input: `{ goalId }`
- Output: `{ goalId, title?, status?, currentStep? }`

### `self_maximize.list_steps`
- Description: list steps/tasks in self-maximize flow for a goal.
- Input: `{ goalId }`
- Output: `{ steps: { id, title, status }[] }`

### `coach.read_messages`
- Description: read current coach thread messages.
- Input: optional `{ limit?, sinceTimestamp? }`
- Output: `CoachMessage[]`

### `coach.get_last_message`
- Description: read latest message in coach thread.
- Input: optional `{ role? }`
- Output: `CoachMessage | null`

### `lifestorming.list_categories`
- Description: list categories available in lifestorming.
- Input: none
- Output: `string[]`

### `lifestorming.list_desires`
- Description: list desires for selected category.
- Input: `{ category }`
- Output: `{ desires: { id, label }[] }`

### `lifestorming.get_brainstorm_items`
- Description: read brainstormed desire items for a category.
- Input: `{ category }`
- Output: `{ items: { id, text, selected? }[] }`

### `lifestorming.get_practice_state`
- Description: read sensation practice state for a desire.
- Input: `{ desireId }`
- Output: `{ desireId, stepIndex, status }`

### `understand.list_modules`
- Description: list understand modules and status.
- Input: none
- Output: `{ modules: { id, title, status }[] }`

### `understand.get_module`
- Description: get details for one understand module.
- Input: `{ moduleId }`
- Output: `{ id, title, content?, status }`

### `help.list_topics`
- Description: list help center topics and links.
- Input: optional `{ query? }`
- Output: `{ topics: { id, title, href }[] }`

### `help.get_topic`
- Description: get details for one help topic.
- Input: `{ topicId }`
- Output: `{ id, title, bodyText?, links? }`

### `legal.get_document`
- Description: read a specific legal/faq document page.
- Input: `{ documentId: "legal" | "terms_v2" | "privacy_v2" | "faq_v2" }`
- Output: `{ documentId, title, sections }`

### `community.list_posts`
- Description: list visible community posts.
- Input: optional `{ tab?, cursor? }`
- Output: `{ posts: { id, author?, textPreview?, createdAt? }[], nextCursor? }`

### `community.get_post`
- Description: read one community post and visible thread.
- Input: `{ postId }`
- Output: `{ id, author?, text?, comments? }`

### `map.get_nodes`
- Description: list visible map nodes and edges.
- Input: optional `{ rootNodeId? }`
- Output: `{ nodes: { id, label, type? }[], edges: { from, to }[] }`

### `map.get_node`
- Description: read details for one map node.
- Input: `{ nodeId }`
- Output: `{ id, label, description?, children? }`

### `assessment.get_status`
- Description: read progress for active assessment.
- Input: `{ assessmentId: "life_history" | "big_five" }`
- Output: `{ assessmentId, progress, status }`

### `assessment.get_question`
- Description: read active assessment question.
- Input: `{ assessmentId }`
- Output: `{ questionId, prompt, options? }`

### `level_check.get_status`
- Description: read latest level-check status or score card.
- Input: none
- Output: `{ completed, score?, band?, timestamp? }`

### `legal.list_links`
- Description: list legal links currently visible.
- Input: none
- Output: `{ termsUrl?, privacyUrl?, faqUrl? }`

### `integration.get_state`
- Description: read persisted integration state snapshot.
- Input: optional `{ key? }`
- Output: `Record<string, unknown>`

### `tasks.list`
- Description: list tasks for a goal.
- Input: `{ goalId, status? }`
- Output: `Task[]`

### `tasks.get`
- Description: read one task for a goal.
- Input: `{ goalId, taskId }`
- Output: `Task`

## 5) Global Mutating Actions (Write / Side Effects)

### `route.navigate`
- Description: navigate to a specific route.
- Input: `{ routeId }`
- Output: `{ ok, url }`

### `auth.signin_password`
- Description: sign in via email/password form.
- Input: `{ email, password }`
- Output: `{ ok }`

### `auth.signin_google`
- Description: initiate Google sign-in flow.
- Input: none
- Output: `{ ok, initiated: true }`

### `auth.signup_password`
- Description: create account via email/password.
- Input: `{ email, password, confirmPassword }`
- Output: `{ ok }`

### `auth.signout`
- Description: sign out current user from goals area.
- Input: none
- Output: `{ ok }`

### `ui.open_more_menu`
- Description: open `More` menu.
- Input: none
- Output: `{ ok, isMoreMenuOpen: true }`

### `ui.close_more_menu`
- Description: close `More` menu.
- Input: none
- Output: `{ ok, isMoreMenuOpen: false }`

### `ui.toggle_goal_list`
- Description: toggle show/hide goals.
- Input: optional `{ visible?: boolean }`
- Output: `{ ok, isGoalListVisible }`

### `goals.select_category`
- Description: set active category context.
- Input: `{ category }`
- Output: `{ ok, selectedGoalCategory }`

### `goals.create`
- Description: create a new goal directly (without requiring lifestorming).
- Input: `{ title, description?, category? }`
- Output: `{ ok, goalId }`

### `goals.update`
- Description: update goal fields.
- Input: `{ goalId, title?, description?, category?, status?, progress? }`
- Output: `{ ok, goalId }`

### `goals.start`
- Description: start/activate a goal.
- Input: `{ goalId }`
- Output: `{ ok, goalId, status: "active" }`

### `goals.pause`
- Description: pause an active goal.
- Input: `{ goalId }`
- Output: `{ ok, goalId, status: "paused" }`

### `goals.complete`
- Description: mark goal complete.
- Input: `{ goalId }`
- Output: `{ ok, goalId, status: "completed" }`

### `goals.archive`
- Description: archive a goal.
- Input: `{ goalId }`
- Output: `{ ok, goalId, status: "archived" }`

### `goals.delete`
- Description: delete a goal.
- Input: `{ goalId, confirm: true }`
- Output: `{ ok, deletedGoalId }`

### `goals.run_lifestorming`
- Description: trigger lifestorming flow.
- Input: optional `{ prompt? }`
- Output: `{ ok }`

### `self_maximize.open_for_goal`
- Description: navigate to self-maximize view for a goal.
- Input: `{ goalId }`
- Output: `{ ok, goalId }`

### `self_maximize.start_session`
- Description: start self-maximize session for the goal.
- Input: `{ goalId }`
- Output: `{ ok, status: "in_progress" }`

### `self_maximize.complete_step`
- Description: complete a step in self-maximize flow.
- Input: `{ goalId, stepId }`
- Output: `{ ok, goalId, stepId }`

### `self_maximize.save_reflection`
- Description: save reflection or notes in self-maximize flow.
- Input: `{ goalId, text }`
- Output: `{ ok }`

### `coach.set_draft`
- Description: write draft text into coach input.
- Input: `{ text }`
- Output: `{ ok, draftLength }`

### `coach.send_message`
- Description: send message to Self Max guide/coach, optionally scoped to a specific goal context.
- Input: `{ text, goalId? }`
- Output: `{ ok, messageId? }`

### `tasks.create`
- Description: add a task under a goal.
- Input: `{ goalId, title, description?, dueAt? }`
- Output: `{ ok, taskId }`

### `tasks.update`
- Description: update task fields.
- Input: `{ goalId, taskId, title?, description?, dueAt?, status? }`
- Output: `{ ok, taskId }`

### `tasks.complete`
- Description: mark task complete.
- Input: `{ goalId, taskId }`
- Output: `{ ok, taskId, status: "completed" }`

### `tasks.uncomplete`
- Description: mark completed task back to incomplete.
- Input: `{ goalId, taskId }`
- Output: `{ ok, taskId, status: "todo" | "in_progress" }`

### `tasks.delete`
- Description: remove task from goal.
- Input: `{ goalId, taskId, confirm: true }`
- Output: `{ ok, taskId }`

### `lifestorming.open`
- Description: open lifestorming root route.
- Input: none
- Output: `{ ok }`

### `lifestorming.select_category`
- Description: choose category in lifestorming.
- Input: `{ category }`
- Output: `{ ok, category }`

### `lifestorming.select_desire`
- Description: choose a desire to continue to sensation practice.
- Input: `{ category, desireId }`
- Output: `{ ok, category, desireId }`

### `lifestorming.brainstorm_desires`
- Description: generate or capture brainstorm items for a category.
- Input: `{ category, prompt? }`
- Output: `{ ok, items: { id, text }[] }`

### `lifestorming.add_desire_to_category`
- Description: add selected brainstorm item as desire in a category.
- Input: `{ category, desireText }`
- Output: `{ ok, desireId }`

### `lifestorming.promote_desire_to_goal`
- Description: convert a desire into a goal in a target category.
- Input: `{ desireId, category }`
- Output: `{ ok, goalId }`

### `lifestorming.next_step`
- Description: move to next practice step.
- Input: `{ desireId }`
- Output: `{ ok, stepIndex }`

### `lifestorming.previous_step`
- Description: move to previous practice step.
- Input: `{ desireId }`
- Output: `{ ok, stepIndex }`

### `lifestorming.complete_practice`
- Description: mark sensation practice complete.
- Input: `{ desireId }`
- Output: `{ ok, status: "completed" }`

### `lifestorming.feel_out_desire`
- Description: run short sensation/practice check on a desire.
- Input: `{ desireId }`
- Output: `{ ok, resonanceScore?, notes? }`

### `understand.open_module`
- Description: open a specific understand module.
- Input: `{ moduleId }`
- Output: `{ ok, moduleId }`

### `understand.mark_module_complete`
- Description: mark an understand module as complete.
- Input: `{ moduleId }`
- Output: `{ ok, moduleId, status: "completed" }`

### `auth.request_password_reset`
- Description: trigger password reset email.
- Input: `{ email }`
- Output: `{ ok, requested: true }`

### `help.search_topics`
- Description: search help topics.
- Input: `{ query }`
- Output: `{ ok, resultCount }`

### `community.open_post`
- Description: open post details from community list.
- Input: `{ postId }`
- Output: `{ ok, postId }`

### `community.create_post`
- Description: create a community post.
- Input: `{ text, visibility? }`
- Output: `{ ok, postId }`

### `community.reply_to_post`
- Description: add reply/comment to a post.
- Input: `{ postId, text }`
- Output: `{ ok, commentId }`

### `community.react_to_post`
- Description: apply reaction to a post.
- Input: `{ postId, reaction }`
- Output: `{ ok, postId, reaction }`

### `map.open_node`
- Description: focus/open a map node.
- Input: `{ nodeId }`
- Output: `{ ok, nodeId }`

### `map.expand_node`
- Description: expand node to load children.
- Input: `{ nodeId }`
- Output: `{ ok, nodeId, expanded: true }`

### `map.collapse_node`
- Description: collapse expanded node.
- Input: `{ nodeId }`
- Output: `{ ok, nodeId, expanded: false }`

### `assessment.start`
- Description: begin an assessment session.
- Input: `{ assessmentId: "life_history" | "big_five" }`
- Output: `{ ok, assessmentId, status: "in_progress" }`

### `assessment.answer_question`
- Description: answer active assessment question.
- Input: `{ assessmentId, questionId, answer }`
- Output: `{ ok, assessmentId, questionId }`

### `assessment.previous_question`
- Description: go back to previous assessment question.
- Input: `{ assessmentId }`
- Output: `{ ok, assessmentId }`

### `assessment.submit`
- Description: submit completed assessment.
- Input: `{ assessmentId, confirm: true }`
- Output: `{ ok, assessmentId, status: "completed" }`

### `level_check.start`
- Description: initiate level-check flow.
- Input: none
- Output: `{ ok, started: true }`

### `level_check.submit`
- Description: submit level-check responses.
- Input: `{ responses }`
- Output: `{ ok, score?, band? }`

### `integration.set_state`
- Description: persist integration state snapshot.
- Input: `{ patch }`
- Output: `{ ok, state }`

## 6) Route-Specific Action Inventory

### `route.home`
- Non-mutating: `route.get_current`
- Mutating: `route.navigate(auth_signin)`, `route.navigate(auth_signup)`, `route.navigate(legal)`

### `route.auth_signin`
- Non-mutating: `auth.get_status`
- Mutating: `auth.signin_password`, `auth.signin_google`, `route.navigate(auth_signup)`, `route.navigate(legal)`

### `route.auth_signup`
- Non-mutating: `auth.get_status`
- Mutating: `auth.signup_password`, `auth.signin_google`, `route.navigate(auth_signin)`, `route.navigate(legal)`

### `route.legal`
- Non-mutating: `legal.list_links`
- Mutating: `route.navigate(home)`, `route.navigate(auth_signin)`, `route.navigate(auth_signup)`

### `route.goals`
- Non-mutating: `goals.list`, `goals.get`, `goals.list_categories`, `tasks.list`, `tasks.get`, `coach.read_messages`, `coach.get_last_message`, `ui.get_visibility`
- Mutating: `ui.open_more_menu`, `ui.close_more_menu`, `ui.toggle_goal_list`, `goals.select_category`, `goals.create`, `goals.update`, `goals.start`, `goals.pause`, `goals.complete`, `goals.archive`, `goals.delete`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.uncomplete`, `tasks.delete`, `goals.run_lifestorming`, `coach.set_draft`, `coach.send_message`, `auth.signout`

### `route.self_maximize`
- Non-mutating: `self_maximize.get_goal_context`, `self_maximize.list_steps`
- Mutating: `self_maximize.open_for_goal`, `self_maximize.start_session`, `self_maximize.complete_step`, `self_maximize.save_reflection`

### `route.lifestorming`
- Non-mutating: `lifestorming.list_categories`
- Mutating: `lifestorming.open`, `lifestorming.select_category`, `lifestorming.brainstorm_desires`, `lifestorming.add_desire_to_category`

### `route.lifestorming_desires_selection`
- Non-mutating: `lifestorming.list_desires`, `lifestorming.get_brainstorm_items`
- Mutating: `lifestorming.select_desire`, `lifestorming.promote_desire_to_goal`

### `route.lifestorming_sensation_practice`
- Non-mutating: `lifestorming.get_practice_state`
- Mutating: `lifestorming.feel_out_desire`, `lifestorming.next_step`, `lifestorming.previous_step`, `lifestorming.complete_practice`

### `route.understand`
- Non-mutating: `understand.list_modules`, `understand.get_module`
- Mutating: `understand.open_module`, `understand.mark_module_complete`

### `route.auth`
- Non-mutating: `auth.get_status`
- Mutating: `auth.signin_password`, `auth.signin_google`, `route.navigate(auth_signup_alt)`, `route.navigate(reset_password)`

### `route.home_legacy`
- Non-mutating: `route.get_current`
- Mutating: `route.navigate(auth)` (redirect expected)

### `route.auth_signup_alt`
- Non-mutating: `auth.get_status`
- Mutating: `auth.signup_password`, `auth.signin_google`, `route.navigate(auth)`

### `route.help`
- Non-mutating: `help.list_topics`, `help.get_topic`
- Mutating: `help.search_topics`, `route.navigate(assessment_life_history)`, `route.navigate(assessment_big_five)`

### `route.faq_v2`
- Non-mutating: `legal.get_document`
- Mutating: `route.navigate(help)`, `route.navigate(legal)`

### `route.terms_v2`
- Non-mutating: `legal.get_document`
- Mutating: `route.navigate(privacy_v2)`, `route.navigate(faq_v2)`

### `route.privacy_v2`
- Non-mutating: `legal.get_document`
- Mutating: `route.navigate(terms_v2)`, `route.navigate(faq_v2)`

### `route.reset_password`
- Non-mutating: `route.get_current`
- Mutating: `auth.request_password_reset`, `route.navigate(auth)`

### `route.community`
- Non-mutating: `community.list_posts`, `community.get_post`
- Mutating: `community.open_post`, `community.create_post`, `community.reply_to_post`, `community.react_to_post`

### `route.map`
- Non-mutating: `map.get_nodes`, `map.get_node`
- Mutating: `map.open_node`, `map.expand_node`, `map.collapse_node`

### `route.assessment_life_history`
- Non-mutating: `assessment.get_status`, `assessment.get_question`
- Mutating: `assessment.start`, `assessment.answer_question`, `assessment.previous_question`, `assessment.submit`

### `route.assessment_big_five`
- Non-mutating: `assessment.get_status`, `assessment.get_question`
- Mutating: `assessment.start`, `assessment.answer_question`, `assessment.previous_question`, `assessment.submit`

### `route.level_check`
- Non-mutating: `level_check.get_status`
- Mutating: `level_check.start`, `level_check.submit`

## 6b) Canonical MVP Process (Requested Flow)

1. `auth.signin_password`
2. `lifestorming.open`
3. `lifestorming.brainstorm_desires`
4. `lifestorming.add_desire_to_category` for `health`, `work`, etc.
5. `lifestorming.feel_out_desire` on a subset of shortlisted desires
6. `lifestorming.promote_desire_to_goal`
7. `coach.send_message` in goal-specific chat context
8. `tasks.create` (add one or more tasks under the goal)
9. `tasks.complete` as tasks are finished
10. `goals.complete` when goal acceptance criteria are met

## 6c) Anytime Actions (User Can Trigger At Any Point)

These actions are available from any authenticated state. The integration should auto-navigate to required route/context before execution.

- Brainstorm new desires:
- `lifestorming.brainstorm_desires`

- Feel out an existing desire:
- `lifestorming.feel_out_desire`

- Turn a desire into a goal:
- `lifestorming.promote_desire_to_goal`

- Create a new goal without lifestorming:
- `goals.create`

- Chat with SelfMax about any goal:
- `coach.send_message` with `{ goalId }`

- Add or remove tasks on any goal:
- `tasks.create`, `tasks.delete`

- Complete or uncomplete tasks:
- `tasks.complete`, `tasks.uncomplete`

- Start, archive, or complete a goal:
- `goals.start`, `goals.archive`, `goals.complete`

## 7) Atomic Action Requirements

- Every mutating action executes atomically per `sessionId`.
- Read-only actions may run concurrently unless they depend on a pending mutation.
- If an action fails after partial UI changes, emit `error` with rollback hint:
- `rollbackHint: "reload_route" | "reopen_menu" | "refetch_goals" | "none"`

## 8) Event/Message Bridge Requirements

### `message.user_to_openclaw`
- `message.openclaw_to_bot`
- `message.bot_to_openclaw`
- `message.openclaw_to_user`
- `event.action_started`
- `event.action_succeeded`
- `event.action_failed`
- `event.state_changed`

Suggested envelope fields:
- `correlationId`
- `sessionId`
- `userId`
- `timestamp`
- `sourceRole`
- `targetRole`
- `actionId` (if applicable)
- `payload`

## 8b) UI Text Prompt Inventory

- Static/dynamic copy used by OpenClaw guidance is documented in `docs/selfmax-ui-text-inventory.md`.
- OpenClaw should use `prompt_id` references from that inventory to ask user questions consistently across routes.

## 9) Open Questions to Resolve in Live DOM Pass

- Confirm stable selectors for all actions, especially per-goal actions.
- Confirm whether goal IDs are directly available in DOM.
- Confirm whether coach message timestamps/IDs are available.
- Confirm best durable storage target in product UI (journal/note/custom field) for `integration.set_state`.
- Confirm route param extraction for `goalId`, `category`, and `desireId` across deep links.
