import { BridgeServer } from "./bridge/index.js";

const server = new BridgeServer();

async function main(): Promise<void> {
  await server.start();
  process.stdout.write("bridge server started\n");
}

main().catch((error) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
