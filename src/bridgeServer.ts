import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { SelfMaxPlaywrightClient } from "./selfmaxClient.js";
import type { BridgeEnvelope, BusRole, SessionContext } from "./types.js";
import { busRoles } from "./types.js";
import { incomingBridgeEnvelopeSchema } from "./schemas.js";
import type { IncomingBridgeEnvelope } from "./schemas.js";
import { ZodError } from "zod";

type ClientCtx = {
  socket: WebSocket;
  role: BusRole;
  session: SessionContext;
};

export class BridgeServer {
  private readonly wss = new WebSocketServer({ port: config.PORT });
  private readonly selfmax = new SelfMaxPlaywrightClient();
  private readonly clients = new Set<ClientCtx>();

  async start(): Promise<void> {
    await this.selfmax.init();

    this.wss.on("connection", (socket, req) => {
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
    if (envelope.type === "primitive") {
      const res = await this.selfmax.execute(envelope.payload, sender.session);
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

    if (envelope.type === "message") {
      const peers = [...this.clients].filter(
        (client) =>
          client !== sender &&
          client.session.sessionId === sender.session.sessionId &&
          client.session.userId === sender.session.userId
      );

      for (const peer of peers) {
        peer.socket.send(JSON.stringify(envelope));
      }
    }
  }
}

function formatInboundError(error: unknown): string {
  if (error instanceof ZodError) {
    return `invalid message: ${error.issues.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`).join("; ")}`;
  }
  return error instanceof Error ? error.message : "invalid message";
}
