import { checkMailreefAccount } from "../integrations/mailreef.js";
import { DEFAULT_SENDER } from "../integrations/outbound-email.js";

// Read-only: only account/sender GET requests. No buying, provisioning, DNS changes or sending.
checkMailreefAccount(process.env.MAILREEF_API_KEY ?? "", DEFAULT_SENDER).then(status => {
  console.log(JSON.stringify({ mode: "read_only_mailreef_check", ...status, sent: false, changed: false }));
  if (!status.billingActive || !status.senderLive) process.exitCode = 1;
}).catch(error => {
  console.error(error instanceof Error ? error.message : "Mailreef readiness check failed.");
  process.exitCode = 1;
});
