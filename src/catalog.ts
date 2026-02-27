export type KnownRouteId = "home" | "signin" | "signup" | "legal" | "goals";

export type KnownActionId =
  | "home.signin"
  | "home.get_started"
  | "signin.submit"
  | "signin.google"
  | "signin.create_account"
  | "signup.submit"
  | "signup.google"
  | "goals.new_goal"
  | "goals.lifestorming"
  | "goals.send_guide_message"
  | "goals.show_goals"
  | "goals.more"
  | "goals.sign_out";

export type KnownAction = {
  id: KnownActionId;
  route: KnownRouteId;
  description: string;
  selector: string;
};

export const knownRoutes: Record<KnownRouteId, string> = {
  home: "https://www.selfmax.ai",
  signin: "https://www.selfmax.ai/auth?mode=sign-in&v=b",
  signup: "https://www.selfmax.ai/auth?mode=sign-up&v=b",
  legal: "https://www.selfmax.ai/legal",
  goals: "https://www.selfmax.ai/goals"
};

export const knownActions: readonly KnownAction[] = [
  {
    id: "home.signin",
    route: "home",
    description: "Open sign in flow from the home page",
    selector: 'a:has-text("sign in"), button:has-text("sign in")'
  },
  {
    id: "home.get_started",
    route: "home",
    description: "Start onboarding from the home page",
    selector: 'a:has-text("get started"), button:has-text("get started")'
  },
  {
    id: "signin.submit",
    route: "signin",
    description: "Submit email/password on sign in",
    selector: 'button:has-text("sign in"), button[type="submit"]'
  },
  {
    id: "signin.google",
    route: "signin",
    description: "Sign in with Google",
    selector: 'button:has-text("google")'
  },
  {
    id: "signin.create_account",
    route: "signin",
    description: "Navigate from sign in to account creation",
    selector: 'a:has-text("create an account"), button:has-text("create an account")'
  },
  {
    id: "signup.submit",
    route: "signup",
    description: "Create account on sign up page",
    selector: 'button:has-text("create account"), button[type="submit"]'
  },
  {
    id: "signup.google",
    route: "signup",
    description: "Create account with Google",
    selector: 'button:has-text("google")'
  },
  {
    id: "goals.new_goal",
    route: "goals",
    description: "Create a new goal",
    selector: 'button:has-text("new goal"), a:has-text("new goal")'
  },
  {
    id: "goals.lifestorming",
    route: "goals",
    description: "Open lifestorming",
    selector: 'button:has-text("lifestorming"), a:has-text("lifestorming")'
  },
  {
    id: "goals.send_guide_message",
    route: "goals",
    description: "Send a message to Self Max guide",
    selector: 'button:has-text("send"), button[type="submit"]'
  },
  {
    id: "goals.show_goals",
    route: "goals",
    description: "Toggle goals visibility",
    selector: 'button:has-text("show goals"), a:has-text("show goals")'
  },
  {
    id: "goals.more",
    route: "goals",
    description: "Open more menu",
    selector: 'button:has-text("more"), a:has-text("more")'
  },
  {
    id: "goals.sign_out",
    route: "goals",
    description: "Sign out from account",
    selector: 'button:has-text("sign out"), a:has-text("sign out")'
  }
];

export const actionById: ReadonlyMap<KnownActionId, KnownAction> = new Map(
  knownActions.map((action) => [action.id, action])
);
