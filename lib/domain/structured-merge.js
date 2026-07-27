import crypto from 'node:crypto';
import { parseDocument } from 'yaml';
import { domainError } from './errors.js';

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function pointerToken(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function jsonLeaves(value, pointer = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ selector: pointer || '/', value }];
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return [{ selector: pointer || '/', value }];
  return entries.flatMap(([key, child]) => jsonLeaves(child, `${pointer}/${pointerToken(key)}`));
}

function decodePointer(pointer) {
  if (pointer === '/') return [];
  return pointer.slice(1).split('/').map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function getJsonValue(document, pointer) {
  let cursor = document;
  for (const token of decodePointer(pointer)) {
    if (!cursor || typeof cursor !== 'object' || !(token in cursor)) return { exists: false };
    cursor = cursor[token];
  }
  return { exists: true, value: cursor };
}

function setJsonValue(document, pointer, value) {
  const tokens = decodePointer(pointer);
  if (tokens.length === 0) return structuredClone(value);
  let cursor = document;
  for (const token of tokens.slice(0, -1)) {
    if (!cursor[token] || typeof cursor[token] !== 'object' || Array.isArray(cursor[token])) cursor[token] = {};
    cursor = cursor[token];
  }
  cursor[tokens.at(-1)] = structuredClone(value);
  return document;
}

function mergeJson({ current, desired, previousUnits }) {
  let currentDocument;
  let desiredDocument;
  try {
    currentDocument = current.trim() ? JSON.parse(current) : {};
    desiredDocument = JSON.parse(desired);
  } catch (error) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'JSON merge input is invalid', {
      format: 'json',
      cause: error.message
    });
  }
  if (!currentDocument || typeof currentDocument !== 'object' || Array.isArray(currentDocument)) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'JSON merge target must contain an object');
  }
  if (!desiredDocument || typeof desiredDocument !== 'object' || Array.isArray(desiredDocument)) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'JSON merge source must contain an object');
  }

  let output = structuredClone(currentDocument);
  const units = {};
  const conflicts = [];
  for (const leaf of jsonLeaves(desiredDocument)) {
    const observed = getJsonValue(currentDocument, leaf.selector);
    const desiredHash = hash(canonicalJson(leaf.value));
    const observedHash = observed.exists ? hash(canonicalJson(observed.value)) : null;
    const previous = previousUnits?.[leaf.selector];
    if (previous && observedHash !== previous.hash) {
      conflicts.push({ selector: leaf.selector, reason: 'OWNED_CONTENT_MODIFIED_EXTERNALLY' });
      continue;
    }
    if (!previous && observed.exists && observedHash !== desiredHash) {
      conflicts.push({ selector: leaf.selector, reason: 'UNKNOWN_EXISTING_CONTENT' });
      continue;
    }
    output = setJsonValue(output, leaf.selector, leaf.value);
    units[leaf.selector] = { hash: desiredHash };
  }
  return {
    content: `${JSON.stringify(output, null, 2)}\n`,
    units,
    conflicts
  };
}

function tableSections(content) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const preamble = [];
  const sections = new Map();
  let current = null;
  for (const line of lines) {
    const match = line.match(/^\s*\[([A-Za-z0-9_.-]+)]\s*(?:#.*)?$/);
    if (match) {
      current = match[1];
      if (sections.has(current)) {
        throw domainError('STRUCTURED_MERGE_PARSE_ERROR', `Duplicate TOML table '${current}'`);
      }
      sections.set(current, [line]);
    } else if (current) {
      sections.get(current).push(line);
    } else if (line.trim()) {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

function normalizeBlock(lines) {
  return `${lines.join('\n').trim()}\n`;
}

function mergeToml({ current, desired, previousUnits }) {
  const target = tableSections(current);
  const source = tableSections(desired);
  if (source.preamble.length > 0 || source.sections.size === 0) {
    throw domainError(
      'TOML_OWNERSHIP_SELECTOR_REQUIRED',
      'TOML merge sources must contain one or more explicit table sections'
    );
  }
  const conflicts = [];
  const units = {};
  for (const [selector, desiredLines] of source.sections) {
    const desiredBlock = normalizeBlock(desiredLines);
    const currentLines = target.sections.get(selector);
    const observedHash = currentLines ? hash(normalizeBlock(currentLines)) : null;
    const desiredHash = hash(desiredBlock);
    const previous = previousUnits?.[selector];
    if (previous && observedHash !== previous.hash) {
      conflicts.push({ selector, reason: 'OWNED_CONTENT_MODIFIED_EXTERNALLY' });
      continue;
    }
    if (!previous && currentLines && observedHash !== desiredHash) {
      conflicts.push({ selector, reason: 'UNKNOWN_EXISTING_CONTENT' });
      continue;
    }
    target.sections.set(selector, desiredBlock.trimEnd().split('\n'));
    units[selector] = { hash: desiredHash };
  }
  const blocks = [];
  if (target.preamble.length) blocks.push(target.preamble.join('\n'));
  for (const lines of target.sections.values()) blocks.push(lines.join('\n').trim());
  return { content: `${blocks.join('\n\n')}\n`, units, conflicts };
}

function markdownMarkers(assetId) {
  return {
    start: `<!-- agents-kit:${assetId}:start -->`,
    end: `<!-- agents-kit:${assetId}:end -->`
  };
}

function markdownBlock(content, markers) {
  const start = content.indexOf(markers.start);
  const end = content.indexOf(markers.end);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < start) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'Markdown ownership markers are malformed');
  }
  const after = end + markers.end.length;
  return { start, end: after, content: content.slice(start, after) };
}

function mergeMarkdown({ current, desired, previousUnits, assetId }) {
  const markers = markdownMarkers(assetId);
  const existing = markdownBlock(current, markers);
  const normalizedDesired = desired.trim();
  const block = `${markers.start}\n${normalizedDesired}\n${markers.end}`;
  const selector = `block:${assetId}`;
  const desiredHash = hash(block);
  const observedHash = existing ? hash(existing.content) : null;
  const previous = previousUnits?.[selector];
  if (previous && observedHash !== previous.hash) {
    return {
      content: current,
      units: {},
      conflicts: [{ selector, reason: 'OWNED_CONTENT_MODIFIED_EXTERNALLY' }]
    };
  }
  if (!previous && existing && observedHash !== desiredHash) {
    return {
      content: current,
      units: {},
      conflicts: [{ selector, reason: 'UNKNOWN_EXISTING_CONTENT' }]
    };
  }
  const content = existing
    ? `${current.slice(0, existing.start)}${block}${current.slice(existing.end)}`
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`;
  return { content, units: { [selector]: { hash: desiredHash } }, conflicts: [] };
}

function jsoncToYaml(content) {
  const commentMap = new Map();
  let counter = 0;
  const regex = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|(\/\/.*)|(\/\*[\s\S]*?\*\/)/g;
  const yamlContent = content.replace(regex, (match, stringVal, singleLine, multiLine) => {
    if (stringVal) return stringVal;
    const placeholder = `__JSONC_COMM_${counter}__`;
    commentMap.set(placeholder, match);
    counter++;
    return `# ${placeholder}`;
  });
  return { yamlContent, commentMap };
}

function yamlToJsonc(yamlContent, commentMap) {
  let jsonc = yamlContent;
  for (const [placeholder, originalComment] of commentMap.entries()) {
    const regex = new RegExp(`#\\s*${placeholder}`, 'g');
    jsonc = jsonc.replace(regex, originalComment);
  }
  return jsonc;
}

function mergeYaml({ current, desired, previousUnits }) {
  const currentYaml = current.trim() ? current : '{}';
  let doc, desiredDoc;
  try {
    doc = parseDocument(currentYaml);
    desiredDoc = parseDocument(desired);
  } catch (error) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'YAML merge input is invalid', {
      format: 'yaml',
      cause: error.message
    });
  }
  if (doc.errors && doc.errors.length > 0) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', `YAML target parse failed: ${doc.errors[0].message}`);
  }
  if (desiredDoc.errors && desiredDoc.errors.length > 0) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', `YAML source parse failed: ${desiredDoc.errors[0].message}`);
  }

  const currentObj = doc.toJSON() || {};
  const desiredObj = desiredDoc.toJSON() || {};

  if (!currentObj || typeof currentObj !== 'object' || Array.isArray(currentObj)) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'YAML merge target must contain an object');
  }
  if (!desiredObj || typeof desiredObj !== 'object' || Array.isArray(desiredObj)) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'YAML merge source must contain an object');
  }

  const units = {};
  const conflicts = [];

  for (const leaf of jsonLeaves(desiredObj)) {
    const observed = getJsonValue(currentObj, leaf.selector);
    const desiredHash = hash(canonicalJson(leaf.value));
    const observedHash = observed.exists ? hash(canonicalJson(observed.value)) : null;
    const previous = previousUnits?.[leaf.selector];
    if (previous && observedHash !== previous.hash) {
      conflicts.push({ selector: leaf.selector, reason: 'OWNED_CONTENT_MODIFIED_EXTERNALLY' });
      continue;
    }
    if (!previous && observed.exists && observedHash !== desiredHash) {
      conflicts.push({ selector: leaf.selector, reason: 'UNKNOWN_EXISTING_CONTENT' });
      continue;
    }
    const tokens = decodePointer(leaf.selector);
    doc.setIn(tokens, leaf.value);
    units[leaf.selector] = { hash: desiredHash };
  }

  return {
    content: doc.toString(),
    units,
    conflicts
  };
}

function mergeJsonc({ current, desired, previousUnits }) {
  const currentYaml = current.trim() ? current : '{}';
  const currentPrep = jsoncToYaml(currentYaml);
  const desiredPrep = jsoncToYaml(desired);

  let doc, desiredDoc;
  try {
    doc = parseDocument(currentPrep.yamlContent);
    desiredDoc = parseDocument(desiredPrep.yamlContent);
  } catch (error) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'JSONC merge input is invalid', {
      format: 'jsonc',
      cause: error.message
    });
  }
  if (doc.errors && doc.errors.length > 0) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', `JSONC target parse failed: ${doc.errors[0].message}`);
  }
  if (desiredDoc.errors && desiredDoc.errors.length > 0) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', `JSONC source parse failed: ${desiredDoc.errors[0].message}`);
  }

  const currentObj = doc.toJSON() || {};
  const desiredObj = desiredDoc.toJSON() || {};

  if (!currentObj || typeof currentObj !== 'object' || Array.isArray(currentObj)) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'JSONC merge target must contain an object');
  }
  if (!desiredObj || typeof desiredObj !== 'object' || Array.isArray(desiredObj)) {
    throw domainError('STRUCTURED_MERGE_PARSE_ERROR', 'JSONC merge source must contain an object');
  }

  const units = {};
  const conflicts = [];

  for (const leaf of jsonLeaves(desiredObj)) {
    const observed = getJsonValue(currentObj, leaf.selector);
    const desiredHash = hash(canonicalJson(leaf.value));
    const observedHash = observed.exists ? hash(canonicalJson(observed.value)) : null;
    const previous = previousUnits?.[leaf.selector];
    if (previous && observedHash !== previous.hash) {
      conflicts.push({ selector: leaf.selector, reason: 'OWNED_CONTENT_MODIFIED_EXTERNALLY' });
      continue;
    }
    if (!previous && observed.exists && observedHash !== desiredHash) {
      conflicts.push({ selector: leaf.selector, reason: 'UNKNOWN_EXISTING_CONTENT' });
      continue;
    }
    const tokens = decodePointer(leaf.selector);
    doc.setIn(tokens, leaf.value);
    units[leaf.selector] = { hash: desiredHash };
  }

  const outputYaml = doc.toString();
  const outputJsonc = yamlToJsonc(outputYaml, currentPrep.commentMap);

  return {
    content: outputJsonc,
    units,
    conflicts
  };
}

function markdownHandler({ current, desired, previousUnits, assetId }) {
  if (!assetId) {
    throw domainError('STRUCTURED_MERGE_ASSET_REQUIRED', 'Markdown merge requires an asset ID');
  }
  return mergeMarkdown({ current, desired, previousUnits, assetId });
}

const FORMAT_STRATEGIES = new Map([
  ['json',          mergeJson],
  ['json-section',  mergeJson],
  ['jsonc',         mergeJsonc],
  ['jsonc-section', mergeJsonc],
  ['yaml',          mergeYaml],
  ['yaml-section',  mergeYaml],
  ['toml',          mergeToml],
  ['toml-section',  mergeToml],
  ['markdown',      markdownHandler]
]);

export function mergeStructuredDocument({
  format,
  current = '',
  desired,
  assetId,
  previousUnits = {}
}) {
  if (typeof desired !== 'string') {
    throw domainError('STRUCTURED_MERGE_SOURCE_REQUIRED', 'Structured merge source must be text');
  }
  const strategy = FORMAT_STRATEGIES.get(format);
  if (!strategy) {
    throw domainError('STRUCTURED_MERGE_FORMAT_UNSUPPORTED', `Merge format '${format}' is unsupported`, {
      format
    });
  }
  return strategy({ current, desired, previousUnits, assetId });
}
