// Helper to invoke Supabase Edge Functions and surface the actual JSON error
// body when the function returns a non-2xx status. supabase-js otherwise
// collapses errors into a generic "Edge Function returned a non-2xx status code".
import { supabase } from "@/integrations/supabase/client";

export interface InvokeError {
  function: string;
  status: number | null;
  message: string;
  code?: string;
  reason?: string;
  raw?: unknown;
}

export interface InvokeResult<T = unknown> {
  data: T | null;
  error: InvokeError | null;
}

export async function invokeFn<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  // Try to read the actual response body from the FunctionsHttpError context
  if (error) {
    let status: number | null = null;
    let parsed: any = null;
    try {
      // FunctionsHttpError attaches the raw Response on `context`
      const ctx: Response | undefined = (error as any).context;
      if (ctx && typeof ctx.status === "number") status = ctx.status;
      if (ctx && typeof ctx.text === "function") {
        const txt = await ctx.clone().text();
        try { parsed = JSON.parse(txt); } catch { parsed = { error: txt?.slice(0, 500) }; }
      }
    } catch { /* ignore */ }

    const message =
      parsed?.error ?? parsed?.message ?? error.message ?? "Edge function failed";
    return {
      data: null,
      error: {
        function: name,
        status,
        message,
        code: parsed?.code,
        reason: parsed?.reason,
        raw: parsed,
      },
    };
  }

  // Some functions return { ok:false, error:"..." } with HTTP 200
  if (data && typeof data === "object" && (data as any).ok === false) {
    const d = data as any;
    return {
      data: null,
      error: {
        function: name,
        status: 200,
        message: d.error ?? "Function returned ok=false",
        code: d.code,
        reason: d.reason,
        raw: d,
      },
    };
  }

  return { data: data as T, error: null };
}

export function formatInvokeError(e: InvokeError): string {
  const parts = [`[${e.function}${e.status ? ` ${e.status}` : ""}]`, e.message];
  if (e.code) parts.push(`(${e.code})`);
  if (e.reason && e.reason !== e.message) parts.push(`— ${e.reason}`);
  return parts.join(" ");
}
