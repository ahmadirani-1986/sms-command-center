// get-sms-config: returns runtime config exposed to the UI.
// Currently exposes REAL_SEND_HARD_CAP so the UI can display the active hard cap
// and clamp the recipient list to the same value the backend enforces.
import { corsHeaders, json } from "../_shared/sms.ts";

const DEFAULT_HARD_CAP = 50;

function readHardCap(): number {
  const raw = Deno.env.get("REAL_SEND_HARD_CAP");
  if (!raw) return DEFAULT_HARD_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HARD_CAP;
  return Math.floor(n);
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return json({
    ok: true,
    real_send_hard_cap: readHardCap(),
    default_hard_cap: DEFAULT_HARD_CAP,
  });
});
