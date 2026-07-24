import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { parseEnvFile } from '../mcp-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

export function parseSimpleYaml(content) {
  const result = {};
  let currentSection = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.endsWith(':') && !trimmed.includes(' ')) {
      currentSection = trimmed.slice(0, -1).trim();
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      if (currentSection && line.startsWith('  ')) {
        result[currentSection][key] = val;
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}

export function loadRootEnv() {
  const osHome = os.homedir();
  const yamlConfigFile = path.join(osHome, '.agents-kit', 'config', 'config.yaml');
  const globalEnvFile = path.join(osHome, '.agents-kit', 'kit', '.env');
  const projectEnvFile = path.join(projectRoot, '.env');

  let mergedEnv = {};

  if (fs.existsSync(yamlConfigFile)) {
    try {
      const parsedYaml = parseSimpleYaml(fs.readFileSync(yamlConfigFile, 'utf-8'));
      if (parsedYaml.llm) {
        if (parsedYaml.llm.provider) mergedEnv.LLM_PROVIDER = parsedYaml.llm.provider;
        if (parsedYaml.llm.keys) {
          if (parsedYaml.llm.keys.openai) mergedEnv.OPENAI_API_KEY = parsedYaml.llm.keys.openai;
          if (parsedYaml.llm.keys.gemini) mergedEnv.GEMINI_API_KEY = parsedYaml.llm.keys.gemini;
          if (parsedYaml.llm.keys.anthropic) mergedEnv.ANTHROPIC_API_KEY = parsedYaml.llm.keys.anthropic;
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  if (fs.existsSync(globalEnvFile)) {
    mergedEnv = { ...mergedEnv, ...parseEnvFile(fs.readFileSync(globalEnvFile, 'utf-8')) };
  }
  if (fs.existsSync(projectEnvFile)) {
    mergedEnv = { ...mergedEnv, ...parseEnvFile(fs.readFileSync(projectEnvFile, 'utf-8')) };
  }

  return { ...mergedEnv, ...process.env };
}

export async function callLlmProvider({
  providerOverride,
  systemPrompt = '',
  userPrompt = ''
}) {
  const env = loadRootEnv();
  const provider = (providerOverride || env.LLM_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'gemini') {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing in agents-kit/.env or environment variables');
    }
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is missing in agents-kit/.env or environment variables');
    }
    const model = env.OPENAI_MODEL || 'gpt-4o';
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  if (provider === 'claude' || provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is missing in agents-kit/.env or environment variables');
    }
    const model = env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    const url = 'https://api.anthropic.com/v1/messages';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt || undefined,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  throw new Error(`Unsupported LLM provider '${provider}'. Valid options: gemini, openai, claude`);
}

/**
 * Common high-level LLM helper for generating and enhancing expert asset content
 */
export async function generateExpertAsset({
  assetType = 'skills',
  currentContent = '',
  additionalPrompt = '',
  provider
}) {
  const { getExpertSystemPrompt } = await import('../defaults/expert-prompts.js');
  const systemPrompt = getExpertSystemPrompt(assetType);

  // Scan local resources dynamically for harness and agents types to provide context
  let resourcesContext = '';
  if (assetType === 'harness' || assetType === 'agents') {
    try {
      const { kitPaths } = await import('../kit-paths.js');
      const osHome = os.homedir();
      // Defaulting to global kit root for scanning available resources if project not specified
      const kitRoot = path.join(osHome, '.agents-kit');
      const kit = kitPaths(path.join(kitRoot, 'kit'), 'global');

      const resources = { skills: [], loops: [], mcp: [] };

      // Scan Skills
      if (fs.existsSync(kit.skillsDir)) {
        const skillsDirs = fs.readdirSync(kit.skillsDir).filter(n => !n.startsWith('.'));
        for (const dir of skillsDirs) {
          const skillFilePath = path.join(kit.skillsDir, dir, 'SKILL.md');
          if (fs.existsSync(skillFilePath)) {
            try {
              const content = fs.readFileSync(skillFilePath, 'utf-8');
              const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
              let description = 'Custom action skill';
              if (yamlMatch) {
                const parsed = parseSimpleYaml(yamlMatch[1]);
                if (parsed.description) description = parsed.description;
              }
              resources.skills.push({ name: dir, path: skillFilePath, description });
            } catch {
              resources.skills.push({ name: dir, path: skillFilePath, description: 'Custom action skill' });
            }
          }
        }
      }

      // Scan Loops
      if (fs.existsSync(kit.loopsDir)) {
        const loopsDirs = fs.readdirSync(kit.loopsDir).filter(n => !n.startsWith('.'));
        for (const dir of loopsDirs) {
          const loopFilePath = path.join(kit.loopsDir, dir, 'LOOP.md');
          if (fs.existsSync(loopFilePath)) {
            resources.loops.push({ name: dir, path: loopFilePath, description: 'Automation loop task' });
          }
        }
      }

      // Build XML representation
      resourcesContext = '\n<available_local_resources>\n';
      if (resources.skills.length > 0) {
        resourcesContext += '  <skills>\n';
        for (const s of resources.skills) {
          resourcesContext += `    - Name: "${s.name}"\n      Path: "file://${s.path}"\n      Description: "${s.description}"\n`;
        }
        resourcesContext += '  </skills>\n';
      }
      if (resources.loops.length > 0) {
        resourcesContext += '  <loops>\n';
        for (const l of resources.loops) {
          resourcesContext += `    - Name: "${l.name}"\n      Path: "file://${l.path}"\n      Description: "${l.description}"\n`;
        }
        resourcesContext += '  </loops>\n';
      }
      resourcesContext += '</available_local_resources>\n';
    } catch (e) {
      // Fail-soft: If scanning fails, proceed without resources context
      resourcesContext = `\n<!-- Local resource scan omitted due to error: ${e.message} -->\n`;
    }
  }

  // Sanitize user inputs and wrap in XML tags to block Prompt Injection
  const safeContent = currentContent.trim().slice(0, 50000); // max token bound
  const safeInstruction = additionalPrompt.trim().slice(0, 2000); // max instruction bound

  const contentSection = safeContent
    ? `<user_existing_content>\n${safeContent}\n</user_existing_content>`
    : `<asset_target_type>${assetType}</asset_target_type>`;

  const instructionSection = safeInstruction
    ? `\n<user_additional_context>\n${safeInstruction}\n</user_additional_context>`
    : '';

  const userPrompt = `${contentSection}${resourcesContext}${instructionSection}\n\nTask: Generate or upgrade the asset specification based strictly on the above data. Output ONLY the raw Markdown/JSON document content without conversational explanation.`;

  const rawText = await callLlmProvider({
    providerOverride: provider,
    systemPrompt,
    userPrompt
  });

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```markdown') && cleaned.endsWith('```')) {
    cleaned = cleaned.slice(11, -3).trim();
  } else if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.slice(3, -3).trim();
  }
  return cleaned;
}
