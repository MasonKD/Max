export const knownRoutes = {
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
export const knownActions = [
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
export const actionById = new Map(knownActions.map((action) => [action.id, action]));
