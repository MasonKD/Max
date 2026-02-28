import { z } from "zod";
import { bridgeEnvelopeTypes, busRoles, primitiveNames } from "./types.js";

export const primitiveNameSchema = z.enum(primitiveNames);
export const busRoleSchema = z.enum(busRoles);
export const bridgeEnvelopeTypeSchema = z.enum(bridgeEnvelopeTypes);

export const recordPayloadSchema = z.record(z.unknown());

export const primitiveRequestSchema = z.object({
  id: z.string().min(1),
  name: primitiveNameSchema,
  payload: recordPayloadSchema.optional()
});

const messageEnvelopeSchema = z.object({
  type: z.literal("message"),
  role: busRoleSchema,
  correlationId: z.string().min(1),
  payload: recordPayloadSchema
});

const primitiveEnvelopeSchema = z.object({
  type: z.literal("primitive"),
  role: busRoleSchema,
  correlationId: z.string().min(1),
  payload: primitiveRequestSchema
});

const responseEnvelopeSchema = z.object({
  type: z.union([z.literal("ack"), z.literal("error")]),
  role: busRoleSchema,
  correlationId: z.string().min(1),
  payload: recordPayloadSchema
});

export const incomingBridgeEnvelopeSchema = z.union([primitiveEnvelopeSchema, messageEnvelopeSchema]);
export const bridgeEnvelopeSchema = z.union([primitiveEnvelopeSchema, messageEnvelopeSchema, responseEnvelopeSchema]);

export type IncomingBridgeEnvelope = z.infer<typeof incomingBridgeEnvelopeSchema>;
