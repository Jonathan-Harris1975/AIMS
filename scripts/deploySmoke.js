import "../config/loadEnv.js";

const port = Number(process.env.PORT || 0) || 0;
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.RSS_INIT_ON_BOOT = process.env.RSS_INIT_ON_BOOT || "false";
process.env.STARTUP_CHECK_REQUIRED_POST_START = process.env.STARTUP_CHECK_REQUIRED_POST_START || "false";

const { startServer, stopServer } = await import("../server.js");

try {
  const server = startServer(port);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Smoke server listen timeout")), 15000);
    server.once("listening", () => {
      clearTimeout(timer);
      resolve();
    });
    server.once("error", reject);
  });

  const address = server.address();
  const listenPort = typeof address === "object" && address ? address.port : port;
  const response = await fetch(`http://127.0.0.1:${listenPort}/health`);
  if (!response.ok) {
    throw new Error(`Health check returned ${response.status}`);
  }

  console.log("✅ Deploy smoke passed");
} finally {
  await stopServer();
}
