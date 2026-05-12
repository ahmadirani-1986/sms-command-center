// SMS encoding detection and segment counter.
// GSM-7 default alphabet (basic subset). We treat anything outside this as Unicode (UCS-2).
const GSM7_BASIC = new Set(
  Array.from(
    "@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5" +
      "\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u00c6\u00e6\u00df\u00c9" +
      " !\"#\u00a4%&'()*+,-./0123456789:;<=>?" +
      "\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7" +
      "\u00bfabcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0",
  ),
);
const GSM7_EXT = new Set(Array.from("\f^{}\\[~]|\u20ac"));

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentInfo {
  encoding: SmsEncoding;
  charCount: number; // logical character count used for segment math
  rawLength: number; // raw JS string length
  segments: number;
  perSingle: number;
  perConcatenated: number;
}

export function detectEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) continue;
    if (GSM7_EXT.has(ch)) continue;
    return "UCS-2";
  }
  return "GSM-7";
}

export function computeSegments(text: string): SegmentInfo {
  const encoding = detectEncoding(text);
  if (encoding === "GSM-7") {
    let chars = 0;
    for (const ch of text) chars += GSM7_EXT.has(ch) ? 2 : 1;
    const perSingle = 160;
    const perConcat = 153;
    const segments = chars === 0 ? 0 : chars <= perSingle ? 1 : Math.ceil(chars / perConcat);
    return { encoding, charCount: chars, rawLength: text.length, segments, perSingle, perConcatenated: perConcat };
  }
  // UCS-2 (Arabic/Unicode)
  const chars = Array.from(text).length;
  const perSingle = 70;
  const perConcat = 67;
  const segments = chars === 0 ? 0 : chars <= perSingle ? 1 : Math.ceil(chars / perConcat);
  return { encoding, charCount: chars, rawLength: text.length, segments, perSingle, perConcatenated: perConcat };
}
