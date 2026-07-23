import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createConfigRouter(ctx) {
  const router = express.Router();
  const { permissionsFilePath } = ctx;

  // Permissions API
  router.get('/api/permissions', (req, res) => {
    try {
      if (!fs.existsSync(permissionsFilePath)) {
        const defaultData = { commands: ["git status", "git diff", "npm test"], updatedAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(permissionsFilePath), { recursive: true });
        fs.writeFileSync(permissionsFilePath, JSON.stringify(defaultData, null, 2));
      }
      const data = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
      res.json(data);
    } catch (err) {
      sendServerError(res, err);
    }
  });

  router.post('/api/permissions', (req, res) => {
    const { command, action } = req.body;
    try {
      let data = { commands: [], updatedAt: new Date().toISOString() };
      if (fs.existsSync(permissionsFilePath)) {
        data = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf-8'));
      }
      if (action === 'add' && command && !data.commands.includes(command)) {
        data.commands.push(command);
      } else if (action === 'remove' && command) {
        data.commands = data.commands.filter(c => c !== command);
      }
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(permissionsFilePath, JSON.stringify(data, null, 2));
      res.json({ success: true, data });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // Helper to parse/read ~/.agents-kit/config/config.yaml
  function getYamlConfigPath() {
    return path.join(os.homedir(), '.agents-kit', 'config', 'config.yaml');
  }

  function readYamlConfig() {
    const cfgFile = getYamlConfigPath();
    if (!fs.existsSync(cfgFile)) return { llm: { keys: {} } };
    try {
      const raw = fs.readFileSync(cfgFile, 'utf-8');
      const lines = raw.split('\n');
      const res = { llm: { keys: {} } };
      let section = '';
      for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (trimmed === 'llm:') { section = 'llm'; continue; }
        if (trimmed === 'keys:') { section = 'keys'; continue; }
        const idx = trimmed.indexOf(':');
        if (idx !== -1) {
          const k = trimmed.slice(0, idx).trim();
          let v = trimmed.slice(idx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          if (section === 'keys') res.llm.keys[k] = v;
          else if (section === 'llm' && k === 'provider') res.llm.provider = v;
        }
      }
      return res;
    } catch {
      return { llm: { keys: {} } };
    }
  }

  function writeYamlConfig(configObj) {
    const cfgFile = getYamlConfigPath();
    const dir = path.dirname(cfgFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const keys = configObj.llm?.keys || {};
    let content = 'llm:\n';
    if (configObj.llm?.provider) {
      content += `  provider: ${configObj.llm.provider}\n`;
    }
    content += '  keys:\n';
    if (keys.openai) content += `    openai: "${keys.openai}"\n`;
    if (keys.gemini) content += `    gemini: "${keys.gemini}"\n`;
    if (keys.anthropic) content += `    anthropic: "${keys.anthropic}"\n`;

    fs.writeFileSync(cfgFile, content, 'utf-8');
  }

  // GET /api/llm-keys — Fetch status of LLM API Keys and default provider from ~/.agents-kit/config/config.yaml
  router.get('/api/llm-keys', (req, res) => {
    try {
      const cfg = readYamlConfig();
      const keys = cfg.llm?.keys || {};
      const provider = cfg.llm?.provider || 'gemini';

      const gemini = keys.gemini || process.env.GEMINI_API_KEY || '';
      const openai = keys.openai || process.env.OPENAI_API_KEY || '';
      const anthropic = keys.anthropic || process.env.ANTHROPIC_API_KEY || '';

      const maskKey = (key) => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : '';

      res.json({
        provider,
        hasGemini: !!gemini,
        hasOpenai: !!openai,
        hasAnthropic: !!anthropic,
        geminiMasked: maskKey(gemini),
        openaiMasked: maskKey(openai),
        anthropicMasked: maskKey(anthropic)
      });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // POST /api/llm-keys — Save LLM API Keys & Provider to ~/.agents-kit/config/config.yaml
  router.post('/api/llm-keys', (req, res) => {
    const { provider, apiKey, geminiApiKey, openaiApiKey, anthropicApiKey } = req.body;
    try {
      const cfg = readYamlConfig();
      if (!cfg.llm) cfg.llm = { provider: 'gemini', keys: {} };
      if (!cfg.llm.keys) cfg.llm.keys = {};

      if (provider) {
        cfg.llm.provider = provider;
        if (apiKey !== undefined && apiKey.trim()) {
          const normKey = provider === 'claude' ? 'anthropic' : provider;
          cfg.llm.keys[normKey] = apiKey.trim();
        }
      }

      if (geminiApiKey !== undefined && geminiApiKey.trim()) cfg.llm.keys.gemini = geminiApiKey.trim();
      if (openaiApiKey !== undefined && openaiApiKey.trim()) cfg.llm.keys.openai = openaiApiKey.trim();
      if (anthropicApiKey !== undefined && anthropicApiKey.trim()) cfg.llm.keys.anthropic = anthropicApiKey.trim();

      writeYamlConfig(cfg);
      res.json({
        success: true,
        provider: cfg.llm.provider,
        message: `~/.agents-kit/config/config.yaml 파일에 기본 프로바이더(${cfg.llm.provider}) 및 API 키가 저장되었습니다.`
      });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  return router;
}
