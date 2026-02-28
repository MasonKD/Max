import { z } from "zod";
import { bridgeEnvelopeTypes, busRoles, primitiveNames, publicApiNames } from "./types.js";

export const primitiveNameSchema = z.enum(primitiveNames);
export const publicApiNameSchema = z.enum(publicApiNames);
export const busRoleSchema = z.enum(busRoles);
export const bridgeEnvelopeTypeSchema = z.enum(bridgeEnvelopeTypes);

const nonEmptyString = z.string().trim().min(1);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const goalStatusSchema = z.enum(["active", "completed", "archived"]);
const goalCategorySchema = z.enum(["Health", "Work", "Love", "Family", "Social", "Fun", "Dreams", "Meaning"]);
const stringArraySchema = z.array(nonEmptyString);
const taskTextsSchema = stringArraySchema.min(1);
const categoryItemsSchema = z.object({
  Health: stringArraySchema.optional(),
  Work: stringArraySchema.optional(),
  Love: stringArraySchema.optional(),
  Family: stringArraySchema.optional(),
  Social: stringArraySchema.optional(),
  Fun: stringArraySchema.optional(),
  Dreams: stringArraySchema.optional(),
  Meaning: stringArraySchema.optional()
}).strict();

const desireToGoalItemSchema = z.object({
  title: nonEmptyString,
  dueDate: isoDateSchema,
  goalTitle: nonEmptyString.optional(),
  goalCategory: goalCategorySchema.optional()
}).strict();

const publicTaskUpdateSchema = z.object({
  task: nonEmptyString,
  action: z.enum(["add", "complete", "uncomplete", "remove"])
}).strict();

const primitivePayloadSchemas = {
  login: z.undefined().optional(),
  get_state: z.undefined().optional(),
  talk_to_guide: z.object({ message: nonEmptyString }).strict(),
  talk_to_goal_chat: z.object({ goalTitle: nonEmptyString, message: nonEmptyString }).strict(),
  read_coach_messages: z.undefined().optional(),
  brainstorm_desires_for_each_category: z.object({ itemsByCategory: categoryItemsSchema }).strict(),
  feel_out_desires: z.object({
    desires: z.array(z.object({ title: nonEmptyString, notes: nonEmptyString }).strict()).min(1)
  }).strict(),
  create_goals_from_desires: z.object({
    desires: z.array(desireToGoalItemSchema).min(1)
  }).strict(),
  create_goal: z.object({
    title: nonEmptyString,
    category: goalCategorySchema,
    dueDate: isoDateSchema
  }).strict(),
  update_goal: z.object({
    goalTitle: nonEmptyString,
    status: goalStatusSchema.optional(),
    dueDate: isoDateSchema.optional()
  }).strict().refine((value) => Boolean(value.status || value.dueDate), {
    message: "status or dueDate is required"
  }),
  read_auth_state: z.undefined().optional(),
  read_current_route: z.undefined().optional(),
  read_known_routes: z.undefined().optional(),
  read_goals_overview: z.undefined().optional(),
  read_route_snapshot: z.object({
    route: nonEmptyString.optional(),
    url: nonEmptyString.optional()
  }).strict().optional(),
  read_page_sections: z.object({
    route: nonEmptyString.optional(),
    url: nonEmptyString.optional()
  }).strict().optional(),
  discover_links: z.object({
    route: nonEmptyString.optional(),
    url: nonEmptyString.optional()
  }).strict().optional(),
  list_goals: z.object({ filter: nonEmptyString.optional() }).strict().optional(),
  discover_goals: z.object({ waitMs: z.unknown().optional() }).strict().optional(),
  read_goal_full: z.object({ goalTitle: nonEmptyString.optional(), goalId: nonEmptyString.optional() }).strict().optional(),
  read_goal_status_details: z.object({ goalTitle: nonEmptyString.optional(), goalId: nonEmptyString.optional() }).strict().optional(),
  read_cached_desires: z.undefined().optional(),
  list_goal_tasks: z.object({ goalTitle: nonEmptyString.optional(), goalId: nonEmptyString.optional() }).strict().optional(),
  read_task_suggestions: z.object({ goalTitle: nonEmptyString }).strict(),
  read_goal_chat: z.object({ goalTitle: nonEmptyString.optional(), goalId: nonEmptyString.optional() }).strict().optional(),
  read_understand_overview: z.undefined().optional(),
  read_level_check: z.undefined().optional(),
  read_life_history_assessment: z.undefined().optional(),
  read_big_five_assessment: z.undefined().optional(),
  read_lifestorming_overview: z.undefined().optional(),
  read_sensation_practice: z.object({ desireId: nonEmptyString.optional(), desireTitle: nonEmptyString.optional() }).strict().refine((value) => Boolean(value.desireId || value.desireTitle), {
    message: "desireId or desireTitle is required"
  }),
  start_goal: z.object({ goalTitle: nonEmptyString.optional(), goalId: nonEmptyString.optional() }).strict().optional(),
  add_tasks: z.object({ goalTitle: nonEmptyString, tasks: taskTextsSchema }).strict(),
  remove_task: z.object({ goalTitle: nonEmptyString, taskTexts: taskTextsSchema }).strict(),
  complete_task: z.object({ goalTitle: nonEmptyString, taskTexts: taskTextsSchema }).strict(),
  uncomplete_task: z.object({ goalTitle: nonEmptyString, taskTexts: taskTextsSchema }).strict()
} satisfies Record<(typeof primitiveNames)[number], z.ZodTypeAny>;

const primitiveRequestSchemas = primitiveNames.map((name) =>
  z.object({
    id: nonEmptyString,
    name: z.literal(name),
    payload: primitivePayloadSchemas[name]
  })
);

export const primitiveRequestSchema = z.discriminatedUnion("name", primitiveRequestSchemas as [
  typeof primitiveRequestSchemas[0],
  typeof primitiveRequestSchemas[1],
  ...typeof primitiveRequestSchemas
]);

const publicApiPayloadSchemas = {
  get_state: z.object({}).strict().optional(),
  get_goals: z.object({
    status: goalStatusSchema.optional(),
    category: goalCategorySchema.optional(),
    deep: z.boolean().optional()
  }).strict().optional(),
  get_goal: z.object({
    goalTitle: nonEmptyString,
    depth: z.number().int().optional()
  }).strict(),
  get_goal_tasks: z.object({
    goalTitle: nonEmptyString
  }).strict(),
  get_goal_chat: z.object({
    goalTitle: nonEmptyString,
    depth: z.number().int().optional()
  }).strict(),
  get_desires: z.object({
    deep: z.boolean().optional()
  }).strict().optional(),
  get_desire: z.object({
    desireTitle: nonEmptyString
  }).strict(),
  get_actions: z.object({}).strict().optional(),
  talk_to_guide: z.object({
    message: nonEmptyString
  }).strict(),
  talk_to_goal_chat: z.object({
    goalTitle: nonEmptyString,
    message: nonEmptyString
  }).strict(),
  add_desires: z.object({
    itemsByCategory: categoryItemsSchema
  }).strict(),
  update_desires: z.object({
    desires: z.array(z.object({ title: nonEmptyString, notes: nonEmptyString }).strict()).min(1)
  }).strict(),
  create_goals_from_desires: z.object({
    desires: z.array(desireToGoalItemSchema).min(1)
  }).strict(),
  create_goal: z.object({
    title: nonEmptyString,
    category: goalCategorySchema,
    dueDate: isoDateSchema
  }).strict(),
  update_goal: z.object({
    goalTitle: nonEmptyString,
    status: goalStatusSchema.optional(),
    dueDate: isoDateSchema.optional()
  }).strict().refine((value) => Boolean(value.status || value.dueDate), {
    message: "status or dueDate is required"
  }),
  update_tasks: z.object({
    goalTitle: nonEmptyString,
    updates: z.array(publicTaskUpdateSchema).min(1)
  }).strict()
} satisfies Record<(typeof publicApiNames)[number], z.ZodTypeAny>;

const publicApiRequestSchemas = publicApiNames.map((name) =>
  z.object({
    id: nonEmptyString,
    name: z.literal(name),
    payload: publicApiPayloadSchemas[name]
  })
);

export const publicApiRequestSchema = z.discriminatedUnion("name", publicApiRequestSchemas as [
  typeof publicApiRequestSchemas[0],
  typeof publicApiRequestSchemas[1],
  ...typeof publicApiRequestSchemas
]);

const messageEnvelopeSchema = z.object({
  type: z.literal("message"),
  role: busRoleSchema,
  correlationId: nonEmptyString,
  payload: z.record(z.unknown())
});

const primitiveEnvelopeSchema = z.object({
  type: z.literal("primitive"),
  role: busRoleSchema,
  correlationId: nonEmptyString,
  payload: primitiveRequestSchema
});

const apiEnvelopeSchema = z.object({
  type: z.literal("api"),
  role: busRoleSchema,
  correlationId: nonEmptyString,
  payload: publicApiRequestSchema
});

const responseEnvelopeSchema = z.object({
  type: z.union([z.literal("ack"), z.literal("error")]),
  role: busRoleSchema,
  correlationId: nonEmptyString,
  payload: z.record(z.unknown())
});

export const incomingBridgeEnvelopeSchema = z.union([primitiveEnvelopeSchema, apiEnvelopeSchema, messageEnvelopeSchema]);
export const bridgeEnvelopeSchema = z.union([primitiveEnvelopeSchema, apiEnvelopeSchema, messageEnvelopeSchema, responseEnvelopeSchema]);

export type IncomingBridgeEnvelope = z.infer<typeof incomingBridgeEnvelopeSchema>;
