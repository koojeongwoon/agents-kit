import fs from 'fs';
import path from 'path';

/** Parse a LOOP.md markdown file into a structured loop object */
export function parseLoopMarkdownFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  let name = path.basename(path.dirname(filePath));
  let description = '';
  let schedule = '0 0 * * *'; // default daily

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('# ') && !name) {
      name = line.slice(2).trim();
    } else if (!description && line && !line.startsWith('#') && !line.startsWith('-')) {
      description = line;
    }

    if (line.toLowerCase().includes('preferred_time:')) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const timeStr = parts.slice(1).join(':').replace(/[`'"]/g, '').trim();
        const [hh, mm] = timeStr.split(':');
        if (hh && mm) {
          schedule = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
        }
      }
    }
  }

  const loopDir = path.dirname(filePath);
  const relRecipePath = path.join('loops', path.basename(loopDir), 'LOOP.md');
  const relMemoryPath = path.join('loops', path.basename(loopDir), 'memory.md');

  return {
    name,
    description: description || `${name} automation loop`,
    schedule,
    recipe: relRecipePath,
    memory: relMemoryPath
  };
}

/** Transpile a loop object into a valid Codex TOML string */
export function buildCodexAutomationToml(loopObj) {
  const escapeString = str => str.replace(/"/g, '\\"');
  return `[automation]
name = "${escapeString(loopObj.name)}"
schedule = "${escapeString(loopObj.schedule)}"
description = "${escapeString(loopObj.description)}"
recipe = "${escapeString(loopObj.recipe)}"
memory = "${escapeString(loopObj.memory)}"
`;
}

/** Scan kit loops directory and return parsed loop objects */
export function parseLoopsDirectory(loopsDir) {
  if (!fs.existsSync(loopsDir)) return [];

  const entries = fs.readdirSync(loopsDir, { withFileTypes: true });
  const loops = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const loopMdPath = path.join(loopsDir, entry.name, 'LOOP.md');
      if (fs.existsSync(loopMdPath)) {
        const loopObj = parseLoopMarkdownFile(loopMdPath);
        if (loopObj) loops.push(loopObj);
      }
    }
  }

  return loops;
}
