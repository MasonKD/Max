export type KnownRouteId =
  | "home"
  | "home_legacy"
  | "signin"
  | "signup"
  | "auth"
  | "auth_signup_alt"
  | "legal"
  | "goals"
  | "lifestorming"
  | "lifestorming_desires_selection"
  | "understand"
  | "help"
  | "faq_v2"
  | "terms_v2"
  | "privacy_v2"
  | "reset_password"
  | "community"
  | "map"
  | "assessment_life_history"
  | "assessment_big_five"
  | "level_check";

export const knownRoutes: Record<KnownRouteId, string> = {
  home: "https://www.selfmax.ai",
  home_legacy: "https://www.selfmax.ai/home",
  signin: "https://www.selfmax.ai/auth?mode=sign-in&v=b",
  signup: "https://www.selfmax.ai/auth?mode=sign-up&v=b",
  auth: "https://www.selfmax.ai/auth",
  auth_signup_alt: "https://www.selfmax.ai/auth?mode=sign-up",
  legal: "https://www.selfmax.ai/legal",
  goals: "https://www.selfmax.ai/goals",
  lifestorming: "https://www.selfmax.ai/lifestorming",
  lifestorming_desires_selection: "https://www.selfmax.ai/lifestorming/desires-selection/category",
  understand: "https://www.selfmax.ai/understand",
  help: "https://www.selfmax.ai/help",
  faq_v2: "https://www.selfmax.ai/faq-v2",
  terms_v2: "https://www.selfmax.ai/terms-of-service-v2",
  privacy_v2: "https://www.selfmax.ai/privacy-policy-v2",
  reset_password: "https://www.selfmax.ai/reset-password",
  community: "https://www.selfmax.ai/community",
  map: "https://www.selfmax.ai/map",
  assessment_life_history: "https://www.selfmax.ai/assessments/life-history",
  assessment_big_five: "https://www.selfmax.ai/assessments/big-five",
  level_check: "https://www.selfmax.ai/level-check"
};
