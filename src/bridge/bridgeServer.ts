import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "../core/config.js";
import { SelfMaxPlaywrightClient } from "../client/index.js";
import type { BridgeEnvelope, BusRole, SessionContext } from "../core/types.js";
import { busRoles } from "../core/types.js";
import { incomingBridgeEnvelopeSchema } from "../core/schemas.js";
import type { IncomingBridgeEnvelope } from "../core/schemas.js";
import { ZodError } from "zod";
import { PublicApi } from "../api/index.js";

type ClientCtx = {
  socket: WebSocket;
  role: BusRole;
  session: SessionContext;
};

export class BridgeServer {
  private readonly wss = new WebSocketServer({ port: config.PORT });
  private readonly selfmax = new SelfMaxPlaywrightClient();
  private readonly publicApi = new PublicApi(this.selfmax);
  private readonly clients = new Set<ClientCtx>();

  async start(): Promise<void> {
    await this.selfmax.init();

    this.wss.on("connection", (socket, req) => {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        socket.close(1008, "local connections only");
        return;
      }
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const rawRole = url.searchParams.get("role") ?? "openclaw";
      const role: BusRole = busRoles.includes(rawRole as BusRole) ? (rawRole as BusRole) : "openclaw";
      const sessionId = url.searchParams.get("sessionId") ?? randomUUID();
      const userId = url.searchParams.get("userId") ?? "anonymous";

      const client: ClientCtx = {
        socket,
        role,
        session: { sessionId, userId }
      };

      this.clients.add(client);

      socket.on("message", async (raw) => {
        try {
          const text = raw.toString("utf-8");
          const envelope = incomingBridgeEnvelopeSchema.parse(JSON.parse(text));
          await this.route(client, envelope);
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: "error",
              role: "selfmax-bot",
              correlationId: randomUUID(),
              payload: {
                error: formatInboundError(error)
              }
            } satisfies BridgeEnvelope)
          );
        }
      });

      socket.on("close", () => {
        this.clients.delete(client);
      });
    });
  }

  async close(): Promise<void> {
    this.wss.close();
    await this.selfmax.close();
  }

  private async route(sender: ClientCtx, envelope: IncomingBridgeEnvelope): Promise<void> {
    if (envelope.type === "api") {
      const res = await this.publicApi.execute(envelope.payload, sender.session);
      sender.socket.send(
        JSON.stringify({
          type: res.ok ? "ack" : "error",
          role: "selfmax-bot",
          correlationId: envelope.correlationId,
          payload: res
        } satisfies BridgeEnvelope)
      );
      return;
    }

    if (envelope.type === "primitive") {
      const res = {
        id: envelope.payload.id,
        ok: false,
        error: "primitive endpoints are private; use public api endpoints"
      };
      sender.socket.send(
        JSON.stringify({
          type: "error",
          role: "selfmax-bot",
          correlationId: envelope.correlationId,
          payload: res
        } satisfies BridgeEnvelope)
      );
      return;
    }

    if (envelope.type === "message") {
      sender.socket.send(
        JSON.stringify({
          type: "error",
          role: "selfmax-bot",
          correlationId: envelope.correlationId,
          payload: {
            error: "message passthrough is disabled in local-only mode"
          }
        } satisfies BridgeEnvelope)
      );
    }
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

function formatInboundError(error: unknown): string {
  if (error instanceof ZodError) {
    return `invalid message: ${error.issues.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`).join("; ")}`;
  }
  return error instanceof Error ? error.message : "invalid message";
}
