import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8080),
  SELFMAX_BASE_URL: z.string().url(),
  SELFMAX_EMAIL: z.string().email(),
  SELFMAX_PASSWORD: z.string().min(1),
  SELFMAX_STATE_KEY: z.string().default("openclaw_state"),
  HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  LOGIN_EMAIL_SELECTOR: z.string().default('input[type="email"]'),
  LOGIN_PASSWORD_SELECTOR: z.string().default('input[type="password"]'),
  LOGIN_SUBMIT_SELECTOR: z.string().default('button[type="submit"]'),
  COACH_INPUT_SELECTOR: z.string().default("textarea"),
  COACH_SEND_SELECTOR: z.string().default('button[type="submit"]'),
  COACH_MESSAGE_SELECTOR: z.string().default('[data-role="coach-message"]')
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const config: AppConfig = EnvSchema.parse(process.env);
