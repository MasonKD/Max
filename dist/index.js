import { BridgeServer } from "./bridgeServer.js";
const server = new BridgeServer();
async function main() {
    await server.start();
    process.stdout.write("bridge server started\n");
}
main().catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        await server.close();
        process.exit(0);
    });
}
