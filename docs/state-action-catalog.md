# SelfMax State + Action Catalog (First Pass)

Source: manual reconnaissance in `docs/selfmax-route-state-action-spec.md`.

## Routes

- `home`: `https://www.selfmax.ai`
- `signin`: `https://www.selfmax.ai/auth?mode=sign-in&v=b`
- `signup`: `https://www.selfmax.ai/auth?mode=sign-up&v=b`
- `legal`: `https://www.selfmax.ai/legal`
- `goals`: `https://www.selfmax.ai/goals`

## State Domains

- `auth`: signed in status, active account, sign-in/sign-up mode
- `session`: user ID, session ID, correlation IDs for message exchange
- `coach`: conversation log, latest assistant/user messages
- `goal-space`: categories (`health`, `work`, `love`, `family`, `social`, `fun`, `dreams`, `meaning`), goal list visibility
- `integration`: bridge health, last primitive run, last known route

## Known Action IDs

- `home.signin`
- `home.get_started`
- `signin.submit`
- `signin.google`
- `signin.create_account`
- `signup.submit`
- `signup.google`
- `goals.new_goal`
- `goals.lifestorming`
- `goals.send_guide_message`
- `goals.show_goals`
- `goals.more`
- `goals.sign_out`

## Gaps (Expected)

- Element selectors are best-effort and must be hardened with real DOM inspection.
- Goal-level CRUD actions are not fully enumerated yet.
- Durable in-app state storage path is still TBD; localStorage is current placeholder.
