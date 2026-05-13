// Minimal cURL template parser shared by edge functions.
// Supports: --location, -X/--request, -H/--header, -d/--data/--data-raw/--data-binary
// Single and double quotes, line continuations (\ + newline).
// Placeholders: {base_url} {api_token} {message} {to} {sender}

export interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export function parseCurl(input: string): ParsedCurl {
  const collapsed = input.replace(/\\\s*\r?\n/g, " ").trim();
  const tokens = tokenize(collapsed);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Template must start with `curl`");
  }
  let method = "POST";
  let url = "";
  const headers: Record<string, string> = {};
  let body: string | null = null;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--location" || t === "-L") continue;
    if (t === "-X" || t === "--request") { method = tokens[++i] ?? method; continue; }
    if (t === "-H" || t === "--header") {
      const h = tokens[++i] ?? "";
      const idx = h.indexOf(":");
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      continue;
    }
    if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      body = tokens[++i] ?? null;
      continue;
    }
    if (t.startsWith("-")) {
      // Skip unknown flag with one possible argument
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) i++;
      continue;
    }
    if (!url) url = t;
  }
  if (!url) throw new Error("Could not find URL in cURL template");
  if (body && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return { method: method.toUpperCase(), url, headers, body };
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let buf = "";
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\" && i + 1 < s.length && quote === '"') { buf += s[i + 1]; i += 2; }
        else { buf += s[i++]; }
      }
      i++; // closing quote
      out.push(buf);
    } else {
      let buf = "";
      while (i < s.length && !/\s/.test(s[i])) {
        if (s[i] === "\\" && i + 1 < s.length) { buf += s[i + 1]; i += 2; }
        else { buf += s[i++]; }
      }
      out.push(buf);
    }
  }
  return out;
}

export interface RenderVars {
  base_url: string;
  api_token: string;
  message: string;
  to: string;
  senderId?: string;
  /** @deprecated alias for senderId; kept for backward compatibility */
  sender?: string;
}

export function renderTemplate(text: string, vars: RenderVars): string {
  const senderVal = vars.senderId ?? vars.sender ?? "";
  return text
    .replaceAll("{base_url}", trimSlash(vars.base_url))
    .replaceAll("{api_token}", vars.api_token)
    .replaceAll("{message}", jsonEscape(vars.message))
    .replaceAll("{to}", vars.to)
    .replaceAll("{senderId}", jsonEscape(senderVal))
    .replaceAll("{sender}", jsonEscape(senderVal));
}

export function renderUrl(text: string, vars: Pick<RenderVars, "base_url" | "to" | "senderId" | "sender">): string {
  const senderVal = vars.senderId ?? vars.sender ?? "";
  return text
    .replaceAll("{base_url}", trimSlash(vars.base_url))
    .replaceAll("{to}", vars.to)
    .replaceAll("{senderId}", senderVal)
    .replaceAll("{sender}", senderVal);
}

function trimSlash(u: string): string { return (u || "").replace(/\/+$/, ""); }
function jsonEscape(s: string): string {
  // Escape so it can sit safely inside a JSON string literal in body
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

export function redactToken(text: string, token: string | null | undefined): string {
  if (!text) return text;
  let out = text;
  if (token) { try { out = out.split(token).join("REDACTED"); } catch { /* ignore */ } }
  // Also redact common bearer/api-key header patterns even if token unknown
  out = out.replace(/(Authorization\s*:\s*Bearer\s+)[^\s'",}]+/gi, "$1REDACTED");
  out = out.replace(/(X-API-Key\s*:\s*)[^\s'",}]+/gi, "$1REDACTED");
  return out;
}

// Detect whether a raw template appears to contain a real (non-placeholder) token.
export function templateLooksLikeRealToken(text: string): boolean {
  // Look at header lines
  const headerRegex = /(Authorization\s*:\s*Bearer\s+|X-API-Key\s*:\s*|api[_-]?key\s*:\s*)([^\s'",}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(text))) {
    const v = m[2];
    if (!v) continue;
    if (v === "{api_token}" || v.includes("{api_token}")) continue;
    if (v.length >= 16) return true;
  }
  return false;
}
