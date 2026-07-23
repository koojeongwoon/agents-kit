import fs from 'fs';
import path from 'path';
import { KIT_ADAPTER_DIRECTORIES } from '../catalog.js';

export const DEFAULT_AGENTS_MD = `# Global Agent Instructions

All AI clients (Google Antigravity, Cursor, Codex, Claude) share these master instructions.

## Working Agreements
- Minimize scope of code changes.
- Follow existing codebase styles and patterns.
- Do not commit secrets or credentials.
`;

export const DEFAULT_ALLOWED_COMMANDS = {
  commands: [
    "npm test",
    "npm run build",
    "git status"
  ]
};

export const DEFAULT_HOOKS = {
  hooks: {}
};

export const DEFAULT_MCP_SERVERS = {
  mcpServers: {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
};

export const DEFAULT_ENV_EXAMPLE = `# Master Kit Environment Variables
# GEMINI_API_KEY=your_key_here
`;

export const DEFAULT_GLOBAL_MEMORY = `# Global Memory

Persistent memory shared across agent sessions.
`;

export const DEFAULT_PROJECT_MEMORY = `# Project Memory

Persistent memory for this specific project repository.
`;

export const DEFAULT_CODE_REVIEWER_AGENT = `---
name: code-reviewer
description: Expert sub-agent for automated code review, security, and performance checks.
---

# Code Reviewer Sub-Agent

You are an expert code reviewer. Review changes for bugs, style consistency, and performance optimizations.
`;

export const DEFAULT_SECURITY_AUDITOR_AGENT = `---
name: security-auditor
description: Specialized sub-agent for auditing security vulnerabilities and credential leaks.
---

# Security Auditor Sub-Agent

Analyze code for OWASP vulnerabilities, secret leaks, and insecure data handling.
`;

export const DEFAULT_DAILY_DOCS_SWEEP_LOOP = `---
name: daily-docs-sweep
interval: 86400
description: Daily automated documentation sweep and update loop recipe.
---

# Daily Docs Sweep Loop

1. Scan codebase for new or updated APIs.
2. Verify README.md and inline documentation are up to date.
3. Report doc gaps to developer.
`;

export const DEFAULT_LOOP_RUNNER_SKILL = `---
name: loop-runner
description: Execute a loop recipe from loops/<name>/LOOP.md.
---

# Loop Runner Skill

Execute automated agent loop workflows defined in loops/<name>/LOOP.md.
`;

export const DEFAULT_LOOP_VERIFY_SKILL = `---
name: loop-verify
description: Verify loop output correctness and test results.
---

# Loop Verify Skill

Validate that executed loop workflows completed with zero errors.
`;

export function bootstrapProjectKit(targetKitDir, projectName) {
  const projectScopeDir = path.join(targetKitDir, 'projects', projectName);
  
  const harnessDir = path.join(projectScopeDir, 'harness');
  const skillsDir = path.join(projectScopeDir, 'skills');
  const agentsDir = path.join(projectScopeDir, 'agents');
  const loopsDir = path.join(projectScopeDir, 'loops');
  const memoryDir = path.join(projectScopeDir, 'memory');
  const mcpDir = path.join(projectScopeDir, 'mcp');
  const adaptersDir = path.join(projectScopeDir, 'adapters');

  for (const ca of KIT_ADAPTER_DIRECTORIES) {
    fs.mkdirSync(path.join(adaptersDir, ca), { recursive: true });
    fs.writeFileSync(path.join(adaptersDir, ca, '.gitkeep'), '');
  }

  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(loopsDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(mcpDir, { recursive: true });

  fs.writeFileSync(path.join(skillsDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(agentsDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(loopsDir, '.gitkeep'), '');

  const projectAgentsMd = `# ${projectName} Agent Instructions\n\nProject-specific rules and guidelines for ${projectName}.\n`;
  fs.writeFileSync(path.join(harnessDir, 'AGENTS.md'), projectAgentsMd);
  fs.writeFileSync(path.join(harnessDir, 'allowed-commands.json'), JSON.stringify({ commands: [] }, null, 2));
  fs.writeFileSync(path.join(harnessDir, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));

  fs.writeFileSync(path.join(mcpDir, 'mcp-servers.json'), JSON.stringify({ mcpServers: {} }, null, 2));
  fs.writeFileSync(path.join(projectScopeDir, '.env.example'), DEFAULT_ENV_EXAMPLE);

  fs.writeFileSync(path.join(memoryDir, 'project_memory.md'), `# ${projectName} Project Memory\n\nPersistent memory for ${projectName}.\n`);

  return projectScopeDir;
}

export function bootstrapDefaultUserKit(targetKitDir) {
  // 1. Bootstrap Global Scope (~/.agents-kit/kit/global)
  const scopeDir = path.join(targetKitDir, 'global');
  const harnessDir = path.join(scopeDir, 'harness');
  const skillsRunnerDir = path.join(scopeDir, 'skills', 'loop-runner');
  const skillsVerifyDir = path.join(scopeDir, 'skills', 'loop-verify');
  const agentsDir = path.join(scopeDir, 'agents');
  const loopDocsDir = path.join(scopeDir, 'loops', 'daily-docs-sweep');
  const memoryDir = path.join(scopeDir, 'memory');
  const mcpDir = path.join(scopeDir, 'mcp');
  const adaptersDir = path.join(scopeDir, 'adapters');

  for (const ca of KIT_ADAPTER_DIRECTORIES) {
    fs.mkdirSync(path.join(adaptersDir, ca), { recursive: true });
    fs.writeFileSync(path.join(adaptersDir, ca, '.gitkeep'), '');
  }

  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(skillsRunnerDir, { recursive: true });
  fs.mkdirSync(skillsVerifyDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(loopDocsDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(mcpDir, { recursive: true });

  // Harness
  fs.writeFileSync(path.join(harnessDir, 'AGENTS.md'), DEFAULT_AGENTS_MD);
  fs.writeFileSync(path.join(harnessDir, 'allowed-commands.json'), JSON.stringify(DEFAULT_ALLOWED_COMMANDS, null, 2));
  fs.writeFileSync(path.join(harnessDir, 'hooks.json'), JSON.stringify(DEFAULT_HOOKS, null, 2));

  // MCP & Env
  fs.writeFileSync(path.join(mcpDir, 'mcp-servers.json'), JSON.stringify(DEFAULT_MCP_SERVERS, null, 2));
  fs.writeFileSync(path.join(scopeDir, '.env.example'), DEFAULT_ENV_EXAMPLE);

  // Memory
  fs.writeFileSync(path.join(memoryDir, 'global_memory.md'), DEFAULT_GLOBAL_MEMORY);

  // Sub-Agents
  fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), DEFAULT_CODE_REVIEWER_AGENT);
  fs.writeFileSync(path.join(agentsDir, 'security-auditor.md'), DEFAULT_SECURITY_AUDITOR_AGENT);

  // Loops
  fs.writeFileSync(path.join(loopDocsDir, 'LOOP.md'), DEFAULT_DAILY_DOCS_SWEEP_LOOP);

  // Skills
  fs.writeFileSync(path.join(skillsRunnerDir, 'SKILL.md'), DEFAULT_LOOP_RUNNER_SKILL);
  fs.writeFileSync(path.join(skillsVerifyDir, 'SKILL.md'), DEFAULT_LOOP_VERIFY_SKILL);

  // 2. Bootstrap Default Project Scope (~/.agents-kit/kit/projects/default)
  bootstrapProjectKit(targetKitDir, 'default');

  const readmeContent = `# 📦 agents-kit Master Kit

Managed agent master kit directory.
Contains 'global' (system-wide) and 'projects/<name>' (project-specific) scopes.
`;
  fs.writeFileSync(path.join(targetKitDir, 'README.md'), readmeContent);
}
