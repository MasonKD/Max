import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf-8").split(/\r?\n/);
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
  let foundKeyValue = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    foundKeyValue = true;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }

  // Fallback: support legacy 3-line format without keys (email/password/url).
  if (!foundKeyValue) {
    for (const token of nonEmpty) {
      if (token.includes("@") && process.env.SELFMAX_EMAIL === undefined) {
        process.env.SELFMAX_EMAIL = token;
        continue;
      }
      if (/^https?:\/\//i.test(token) && process.env.SELFMAX_BASE_URL === undefined) {
        process.env.SELFMAX_BASE_URL = token;
        continue;
      }
      if (process.env.SELFMAX_PASSWORD === undefined) {
        process.env.SELFMAX_PASSWORD = token;
      }
    }
  }
}

loadDotEnv();

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8080),
  SELFMAX_BASE_URL: z.string().url(),
  SELFMAX_EMAIL: z.string().email(),
  SELFMAX_PASSWORD: z.string().min(1),
  SELFMAX_STATE_KEY: z.string().default("openclaw_state"),
  SELFMAX_STORAGE_STATE_PATH: z.string().default(".auth/selfmax-storage-state.json"),
  SELFMAX_AUTH_MIN_ARCHIVED: z.coerce.number().default(1),
  HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  LOGIN_EMAIL_SELECTOR: z.string().default('input[type="email"]'),
  LOGIN_PASSWORD_SELECTOR: z.string().default('input[type="password"]'),
  LOGIN_SUBMIT_SELECTOR: z.string().default('button[type="submit"]'),
  COACH_INPUT_SELECTOR: z.string().default("textarea"),
  COACH_SEND_SELECTOR: z.string().default('button[type="submit"]'),
  COACH_MESSAGE_SELECTOR: z.string().default('[data-role="coach-message"]'),
  LOG_LEVEL: z.string().default("info"),
  LOG_PRETTY: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  LOG_TIMINGS: z
    .string()
    .optional()
    .transform((v) => v !== "false")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const config: AppConfig = EnvSchema.parse(process.env);
