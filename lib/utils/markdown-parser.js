import fs from 'fs';
import path from 'path';

/** Simple zero-dependency YAML frontmatter + markdown body parser */
export function parseFrontmatterMarkdown(fileContent) {
  const lines = fileContent.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { data: {}, content: fileContent.trim() };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { data: {}, content: fileContent.trim() };
  }

  const frontmatterLines = lines.slice(1, endIdx);
  const bodyLines = lines.slice(endIdx + 1);
  const data = {};

  for (const line of frontmatterLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let valStr = trimmed.slice(colonIdx + 1).trim();

    // Parse arrays like [tool1, tool2]
    if (valStr.startsWith('[') && valStr.endsWith(']')) {
      data[key] = valStr
          .slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
    } else {
      // Clean string quotes
      if (
        (valStr.startsWith('"') && valStr.endsWith('"')) ||
        (valStr.startsWith("'") && valStr.endsWith("'"))
      ) {
        valStr = valStr.slice(1, -1);
      }
      data[key] = valStr;
    }
  }

  return {
    data,
    content: bodyLines.join('\n').trim()
  };
}

/** Read a subagent markdown file and return a structured agent object for plugin.json */
export function parseSubagentMarkdownFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const { data, content: body } = parseFrontmatterMarkdown(content);

  const name = data.name || path.basename(filePath, '.md');
  const description = data.description || '';
  let tools = data.tools || [];
  if (typeof tools === 'string') {
    tools = tools.split(',').map(s => s.trim()).filter(Boolean);
  }

  return {
    name,
    description,
    tools,
    system_prompt: body
  };
}

/** Scan an agents directory and parse all *.md files into an array of agent objects */
export function parseAgentsDirectory(agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  const agents = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const agentObj = parseSubagentMarkdownFile(path.join(agentsDir, entry.name));
      if (agentObj) agents.push(agentObj);
    }
  }

  return agents;
}
