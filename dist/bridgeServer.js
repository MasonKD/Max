import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { SelfMaxPlaywrightClient } from "./selfmaxClient.js";
const validRoles = ["openclaw", "selfmax-bot", "end-user"];
export class BridgeServer {
    wss = new WebSocketServer({ port: config.PORT });
    selfmax = new SelfMaxPlaywrightClient();
    clients = new Set();
    async start() {
        await this.selfmax.init();
        this.wss.on("connection", (socket, req) => {
            const url = new URL(req.url ?? "", `http://${req.headers.host}`);
            const rawRole = url.searchParams.get("role") ?? "openclaw";
            const role = validRoles.includes(rawRole) ? rawRole : "openclaw";
            const sessionId = url.searchParams.get("sessionId") ?? randomUUID();
            const userId = url.searchParams.get("userId") ?? "anonymous";
            const client = {
                socket,
                role,
                session: { sessionId, userId }
            };
            this.clients.add(client);
            socket.on("message", async (raw) => {
                try {
                    const text = raw.toString("utf-8");
                    const envelope = JSON.parse(text);
                    await this.route(client, envelope);
                }
                catch (error) {
                    socket.send(JSON.stringify({
                        type: "error",
                        role: "selfmax-bot",
                        correlationId: randomUUID(),
                        payload: {
                            error: error instanceof Error ? error.message : "invalid message"
                        }
                    }));
                }
            });
            socket.on("close", () => {
                this.clients.delete(client);
            });
        });
    }
    async close() {
        this.wss.close();
        await this.selfmax.close();
    }
    async route(sender, envelope) {
        if (envelope.type === "primitive") {
            const req = envelope.payload;
            const res = await this.selfmax.execute(req, sender.session);
            sender.socket.send(JSON.stringify({
                type: res.ok ? "ack" : "error",
                role: "selfmax-bot",
                correlationId: envelope.correlationId,
                payload: res
            }));
            return;
        }
        if (envelope.type === "message") {
            const peers = [...this.clients].filter((client) => client !== sender &&
                client.session.sessionId === sender.session.sessionId &&
                client.session.userId === sender.session.userId);
            for (const peer of peers) {
                peer.socket.send(JSON.stringify(envelope));
            }
        }
    }
}
