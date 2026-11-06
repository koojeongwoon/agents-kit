// A conservative, bounded merge of file data. Ambiguous edits are never guessed.
const equal = (a, b) => a === b || (!!a && !!b && a.mode === b.mode && a.content.equals(b.content));
const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];

export function utf8Text(bytes) {
  try { const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); return text.includes('\0') ? null : text; }
  catch { return null; }
}

function hunks(base, changed) {
  let start = 0, end = base.length, otherEnd = changed.length;
  while (start < end && start < otherEnd && base[start] === changed[start]) start++;
  while (end > start && otherEnd > start && base[end - 1] === changed[otherEnd - 1]) { end--; otherEnd--; }
  const n = end - start, m = otherEnd - start;
  if ((n + 1) * (m + 1) > 2000000) return null;
  const width = m + 1, matrix = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    matrix[i * width + j] = base[start + i] === changed[start + j]
      ? matrix[(i + 1) * width + j + 1] + 1 : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
  }
  const result = [];
  let i = 0, j = 0, active;
  const flush = () => { if (active) result.push(active); active = undefined; };
  while (i < n || j < m) {
    if (i < n && j < m && base[start + i] === changed[start + j]) { flush(); i++; j++; continue; }
    active ||= {start: start + i, end: start + i, lines: []};
    if (j < m && (i === n || matrix[i * width + j + 1] > matrix[(i + 1) * width + j])) active.lines.push(changed[start + j++]);
    else { i++; active.end = start + i; }
  }
  flush(); return result;
}

function mergeText(baseText, kitText, upstreamText) {
  const base = lines(baseText), left = hunks(base, lines(kitText)), right = hunks(base, lines(upstreamText));
  if (!left || !right) return null;
  const combined = [...left];
  for (const incoming of right) {
    let duplicate = false;
    for (const existing of left) {
      const overlaps = incoming.start === incoming.end || existing.start === existing.end
        ? incoming.start <= existing.end && existing.start <= incoming.end
        : incoming.start < existing.end && existing.start < incoming.end;
      if (!overlaps) continue;
      if (JSON.stringify(incoming) !== JSON.stringify(existing)) return null;
      duplicate = true;
    }
    if (!duplicate) combined.push(incoming);
  }
  const output = [...base];
  for (const hunk of combined.sort((a, b) => b.start - a.start)) output.splice(hunk.start, hunk.end - hunk.start, ...hunk.lines);
  return output.join('');
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function mergeJson(base, kit, upstream) {
  if (sameJson(kit, base)) return {value: upstream};
  if (sameJson(upstream, base) || sameJson(kit, upstream)) return {value: kit};
  if (![base, kit, upstream].every(object)) return null;
  const value = Object.create(null);
  for (const key of new Set([...Object.keys(base), ...Object.keys(kit), ...Object.keys(upstream)])) {
    const result = mergeJson(base[key], kit[key], upstream[key]);
    if (!result) return null;
    if (result.value !== undefined) value[key] = result.value;
  }
  return {value};
}

export function mergeSourceFile(base, kit, upstream, {json = false} = {}) {
  if (equal(kit, base)) return {file: upstream, reason: 'UPSTREAM_ONLY'};
  if (equal(upstream, base)) return {file: kit, reason: 'KIT_ONLY'};
  if (equal(kit, upstream)) return {file: kit, reason: 'IDENTICAL'};
  if (!base || !kit || !upstream) return {conflict: 'DELETE_MODIFY_OR_ADD_ADD'};
  const mode = kit.mode === base.mode ? upstream.mode : upstream.mode === base.mode || upstream.mode === kit.mode ? kit.mode : null;
  if (mode === null) return {conflict: 'MODE_CONFLICT'};
  const content = kit.content.equals(base.content) ? upstream.content
    : upstream.content.equals(base.content) || kit.content.equals(upstream.content) ? kit.content : null;
  if (content) return {file: {...kit, mode, content}, reason: 'MERGED'};
  const texts = [base, kit, upstream].map(file => utf8Text(file.content));
  if (texts.includes(null)) return {conflict: 'BINARY_CONFLICT'};
  let text;
  if (json) {
    try {
      const result = mergeJson(...texts.map(value => JSON.parse(value)));
      if (result) text = `${JSON.stringify(result.value, null, 2)}\n`;
    } catch { /* Invalid native syntax is validated separately. */ }
  } else text = mergeText(...texts);
  return text === null || text === undefined ? {conflict: 'OVERLAPPING_CHANGES'}
    : {file: {...kit, mode, content: Buffer.from(text)}, reason: 'MERGED'};
}
