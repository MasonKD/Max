export type PrimitiveName =
  | "login"
  | "get_state"
  | "set_state"
  | "send_coach_message"
  | "read_coach_messages"
  | "navigate"
  | "list_known_actions"
  | "invoke_known_action";

export type PrimitiveRequest = {
  id: string;
  name: PrimitiveName;
  payload?: Record<string, unknown>;
};

export type PrimitiveResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type BusRole = "openclaw" | "selfmax-bot" | "end-user";

export type BridgeEnvelope = {
  type: "primitive" | "message" | "ack" | "error";
  role: BusRole;
  correlationId: string;
  payload: Record<string, unknown>;
};

export type SessionContext = {
  sessionId: string;
  userId: string;
};
