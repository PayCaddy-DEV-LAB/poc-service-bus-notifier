import "dotenv/config";
import { getDeliveryLog } from "../src/db.js";

function parseArgs(): { clientId?: string; status?: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };
  return { clientId: get("--clientId"), status: get("--status") };
}

const { clientId, status } = parseArgs();
const rows = getDeliveryLog({ clientId, status });

if (rows.length === 0) {
  console.log("No records found.");
} else {
  console.log(`\nDelivery log (${rows.length} rows):\n`);
  console.table(
    rows.map((r) => ({
      id: r.id,
      client: r.client_id,
      event: r.event_type,
      status: r.status,
      attempt: r.attempt,
      http: r.http_status ?? "-",
      error: r.error_message ? r.error_message.slice(0, 60) : "-",
      at: r.delivered_at,
    }))
  );
}
