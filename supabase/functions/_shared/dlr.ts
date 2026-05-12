// Shared DLR helpers
export const REDACT = "[REDACTED]";

export function redactToken(text: string, token?: string | null): string {
  if (!token) return text;
  try { return text.split(token).join(REDACT); } catch { return text; }
}

export interface ParsedDlr {
  current_status: string | null;
  api_status: string | null;
  dlr_code: string | null;
  remarks: string | null;
  report_status: string | null;
  error_code: string | null;
  error_description: string | null;
  status_text: string | null;
  received_at_utc: string | null;
  has_data: boolean;
}

export function parseDlrResponse(parsed: unknown): ParsedDlr {
  const empty: ParsedDlr = {
    current_status: null, api_status: null, dlr_code: null, remarks: null,
    report_status: null, error_code: null, error_description: null,
    status_text: null, received_at_utc: null, has_data: false,
  };
  if (!parsed || typeof parsed !== "object") return empty;
  const root = parsed as Record<string, unknown>;
  const data = root.data;
  if (!Array.isArray(data) || data.length === 0) return empty;
  const d = data[0] as Record<string, unknown>;
  const reports = Array.isArray(d.reports) ? d.reports as Array<Record<string, unknown>> : [];
  const rep = reports[0] ?? {};
  return {
    current_status: (d.currentStatus as string) ?? null,
    api_status: (d.status as string) ?? null,
    dlr_code: d.dlrCode != null ? String(d.dlrCode) : null,
    remarks: (d.remarks as string) ?? null,
    report_status: (rep.dlrStatus as string) ?? null,
    error_code: rep.errorCode != null ? String(rep.errorCode) : null,
    error_description: (rep.errorDescription as string) ?? null,
    status_text: (rep.statusText as string) ?? null,
    received_at_utc: (rep.receivedAtUtc as string) ?? null,
    has_data: true,
  };
}
