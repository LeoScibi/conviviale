// A recipe's method as numbered steps. METHOD stays one text cell in the sheet, one step per
// line, so it can still be typed there. Older methods written as paragraphs (blank lines
// between them) read one paragraph per step; numbering typed in ("1.", "Step 2:") is dropped.

const NUMBERING = /^\s*(?:step\s*)?\d+\s*[.):-]?\s+|^\s*[-*•]\s+/i;

export function parseSteps(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const parts = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
  return parts.map(p => p.replace(/\s*\n\s*/g, ' ').replace(NUMBERING, '').trim()).filter(Boolean);
}

/** Steps back to the stored text: one per line, without numbers. */
export function joinSteps(steps) {
  return steps.map(s => String(s).replace(/\s*\n\s*/g, ' ').replace(NUMBERING, '').trim()).filter(Boolean).join('\n');
}
