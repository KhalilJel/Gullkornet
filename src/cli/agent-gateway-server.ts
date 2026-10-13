import { createGatewayServer } from "../gateway/agent-gateway.js";

const token = process.env.AGENT_GATEWAY_TOKEN?.trim();
const hermesUrl = process.env.HERMES_API_URL?.trim();
const hermesKey = process.env.HERMES_API_KEY?.trim();
if (!token || !hermesUrl || !hermesKey) {
  console.error("AGENT_GATEWAY_TOKEN, HERMES_API_URL and HERMES_API_KEY are required");
  process.exit(2);
}
// Hermes is private. Refuse any target that is not on Railway's internal network or loopback.
const host = new URL(hermesUrl).hostname;
if (!host.endsWith(".railway.internal") && host !== "localhost" && host !== "127.0.0.1") {
  console.error("HERMES_API_URL must be a .railway.internal address");
  process.exit(2);
}
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
createGatewayServer({ token, hermesUrl, hermesKey }).listen(port, () => console.log(`agent-gateway listening on ${port}`));
