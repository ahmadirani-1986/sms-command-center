// test-raw-template: send a single SMS to one whitelisted number using a raw cURL template.
import { authenticate, audit, corsHeaders, isValidPhone, json, normalizePhone, redact } from "../_shared/sms.ts";
import { parseCurl, redactToken, renderTemplate } from "../_shared/curl.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let manualToken: string | null = null;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = await authenticate(req, url, anon, sk);
    if ("error" in auth) return auth.error;
    const { ctx, admin } = auth;
    if (!ctx.isAdmin) return json({ ok: false, error: "Admin only", code: "FORBIDDEN" }, 403);

    const body = await req.json();
    const { template_id, to, message, sender, senderId, confirmation_text } = body ?? {};
    const senderValue: string = (senderId ?? sender ?? "") as string;
    manualToken = typeof body?.manual_token === "string" && body.manual_token.length > 0 ? body.manual_token : null;
    if (!template_id) return json({ ok: false, error: "template_id required", code: "VALIDATION_ERROR" }, 400);
    if (!to || !message) return json({ ok: false, error: "to and message required", code: "VALIDATION_ERROR" }, 400);

    const { data: tpl, error: tErr } = await admin
      .from("sms_raw_templates").select("*").eq("id", template_id).single();
    if (tErr || !tpl) return json({ ok: false, error: "Template not found", code: "TEMPLATE_NOT_FOUND" }, 404);
    if (!tpl.is_active) return json({ ok: false, error: "Template is inactive", code: "TEMPLATE_INACTIVE" }, 400);

    // Whitelist check
    const normalized = normalizePhone(String(to));
    if (!isValidPhone(normalized)) return json({ ok: false, error: "Invalid phone number", code: "INVALID_PHONE" }, 400);
    const { data: allowed } = await admin.from("sms_test_allowed_numbers")
      .select("phone_normalized").eq("is_active", true).eq("phone_normalized", normalized).maybeSingle();
    if (!allowed) return json({ ok: false, error: "Recipient not whitelisted", code: "NOT_WHITELISTED" }, 400);

    if (confirmation_text !== "CONFIRM RAW API TEST 1") {
      return json({ ok: false, error: "Confirmation must equal: CONFIRM RAW API TEST 1", code: "CONFIRMATION_MISMATCH" }, 400);
    }

    // Resolve token
    let token: string | null = null;
    if (tpl.credential_mode === "manual_token") {
      if (!manualToken) return json({ ok: false, error: "Manual token required", code: "MANUAL_TOKEN_REQUIRED" }, 400);
      token = manualToken;
      await audit(admin, ctx, "manual_token.used_for_raw_template", "sms_raw_template", template_id, { name: tpl.name });
    } else {
      const sn = tpl.credential_secret_name;
      if (!sn) return json({ ok: false, error: "Template missing credential_secret_name", code: "TEMPLATE_MISCONFIGURED" }, 400);
      token = Deno.env.get(sn) ?? null;
      if (!token) return json({ ok: false, error: `Backend secret '${sn}' not found.`, code: "BACKEND_SECRET_MISSING", secret_name: sn }, 400);
    }

    const rendered = renderTemplate(tpl.raw_curl, {
      base_url: tpl.base_url,
      api_token: token,
      message: String(message),
      to: normalized,
      sender: sender ? String(sender) : "",
    });

    let parsed;
    try { parsed = parseCurl(rendered); }
    catch (e) { return json({ ok: false, error: `Failed to parse cURL: ${(e as Error).message}`, code: "PARSE_ERROR" }, 400); }

    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.headers)) {
      safeHeaders[k] = (k.toLowerCase() === "authorization" || k.toLowerCase().includes("api-key") || k.toLowerCase().includes("apikey"))
        ? "REDACTED" : v;
    }
    console.log("test-raw-template debug", {
      user_id: ctx.userId, template_id, name: tpl.name,
      url: parsed.url, method: parsed.method, headers: safeHeaders,
      body_len: parsed.body?.length ?? 0, credential_mode: tpl.credential_mode,
    });

    const t0 = Date.now();
    let httpStatus = 0, responseText = "", parsedResp: any = null, errMsg: string | null = null;
    try {
      const resp = await fetch(parsed.url, {
        method: parsed.method,
        headers: parsed.headers,
        body: parsed.body ?? undefined,
      });
      httpStatus = resp.status;
      responseText = await resp.text();
      try { parsedResp = JSON.parse(responseText); } catch { /* keep raw */ }
    } catch (e) {
      errMsg = redact(String((e as Error).message ?? e), token);
    }
    const latency = Date.now() - t0;

    const dataObj = Array.isArray(parsedResp?.data) ? parsedResp.data[0] : null;
    const result = {
      ok: httpStatus >= 200 && httpStatus < 300 && !errMsg,
      http_status: httpStatus,
      latency_ms: latency,
      smsCampaignId: dataObj?.smsCampaignId ?? dataObj?.campaignId ?? null,
      smsMessageId: dataObj?.smsMessageId ?? null,
      to: dataObj?.to ?? null,
      dlrCode: dataObj?.dlrCode ?? null,
      currentStatus: dataObj?.currentStatus ?? null,
      status: dataObj?.status ?? parsedResp?.status ?? null,
      remarks: dataObj?.remarks ?? null,
      response_preview: redactToken(responseText.slice(0, 2000), token),
      rendered_preview: redactToken(rendered, token),
      error: errMsg,
    };

    await audit(admin, ctx, "raw_template.tested", "sms_raw_template", template_id, {
      name: tpl.name, http_status: httpStatus, latency_ms: latency, ok: result.ok,
    });

    return json(result, 200);
  } catch (e) {
    const msg = redact(String((e as Error).message ?? e), manualToken);
    console.error("test-raw-template error", msg);
    return json({ ok: false, error: msg, code: "UNCAUGHT" }, 500);
  }
});
