# Client Capability Audit

## Purpose

This audit prevents current adapter behavior from being mistaken for a verified
client contract. A path or feature must not be marked `stable` in the future
capability matrix until it has current first-party documentation or an
equivalent first-party machine-readable contract.

## Verification states

| State | Meaning |
|---|---|
| `verified` | Confirmed by current first-party documentation |
| `partially-verified` | Some assets are documented; the complete mapping is not |
| `version-dependent` | Support depends on a detected client version or channel |
| `ui-only` | The client exposes the feature without a supported file contract |
| `unverified` | Present in current Agent Kit code but not yet confirmed |
| `unsupported` | First-party documentation explicitly excludes the capability |

These audit states are evidence states. The later product capability model may
map them to `stable`, `preview`, `version-dependent`, `ui-only`, or
`unsupported`.

## Current adapter inventory

### Claude Code

Current Agent Kit outputs include:

- `.claude/CLAUDE.md`
- `.claude/hooks.json`
- `.claude/skills`
- `.mcp.json` for project scope
- `.claude.json` for global scope
- `.claude/agents`
- `.claude/loops`
- `.claude/global_memory.md`

Audit status: `verified per capability`, with unsupported or unverified
capabilities explicitly blocked.

The data-driven definition in `clients/claude-code.yaml` records verified
settings, instructions, skills, agents, MCP, and settings-based hook mappings.
The legacy standalone `.claude/hooks.json`, `.claude/loops`, and
`.claude/global_memory.md` mappings are not promoted to stable contracts.

Evidence:

- <https://code.claude.com/docs/en/settings>
- <https://code.claude.com/docs/en/skills>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/mcp>

### Codex

Current Agent Kit outputs include:

- `.codex/AGENTS.md`
- `.codex/skills`
- `.codex/mcp.json`
- `.codex/agents`
- `.codex/automations/*.toml`
- `.codex/global_memory.md`
- `.codex/allowed_commands.json`

Audit status: `verified per capability`, with unsupported or unverified
capabilities explicitly blocked.

The data-driven definition in `clients/codex.yaml` records verified AGENTS.md,
skills, config, MCP, subagent, and hook mappings. In particular, project skills
use `.agents/skills`, MCP and agent roles are config sections, and project
instructions use repository `AGENTS.md`. The current legacy adapter paths
remain compatibility behavior only.

Evidence:

- <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- <https://learn.chatgpt.com/docs/build-skills>
- <https://learn.chatgpt.com/docs/config-file/config-advanced>
- <https://learn.chatgpt.com/docs/extend/mcp>
- <https://learn.chatgpt.com/docs/hooks>
- <https://learn.chatgpt.com/docs/agent-configuration/subagents>

### Cursor

Current Agent Kit outputs include:

- `.cursorrules`
- `.cursor/skills`
- `.cursor/mcp.json`
- `.cursor/agents`
- `.cursor/loops`
- `.cursor/rules/global_memory.md`
- `.cursor/permissions.json`

Audit status: `version-dependent`.

First-party Cursor material confirms rules, skills, subagents, hooks, plugins,
and JSON-based MCP assets, but current support varies by release and channel.
The legacy `.cursorrules` path and every custom memory/permission mapping need
separate verification.

Evidence:

- <https://cursor.com/changelog/2-4>
- <https://cursor.com/changelog/2-5>
- <https://cursor.com/blog/agent-best-practices>

### Google Antigravity

Current Agent Kit outputs include plugin-scoped rules, hooks, skills, agents,
loops, plugin metadata, MCP configuration, permissions, and memory.

Audit status: `unverified`.

All file contracts and supported scopes require first-party verification.

### Claude Desktop

Current Agent Kit outputs include desktop MCP configuration plus Agent Kit
compatibility files for instructions, skills, loops, and memory.

Audit status: `unverified`.

Claude Desktop MCP configuration must be audited separately from Claude Code.
No Claude Code capability should be inherited implicitly by Claude Desktop.

## Target clients not yet represented

The reconstruction roadmap also requires separate definitions for:

- Windsurf
- GitHub Copilot / VS Code

They must be added only after first-party capability audits. VS Code settings,
VS Code MCP configuration, Copilot instructions, prompts, agents, and skills
must remain separate asset contracts even when they share a workspace.

## Required evidence per capability

Every future client capability entry must record:

- client ID
- asset kind
- global/project/local scope
- path or supported API
- format
- minimum and maximum known client versions when applicable
- evidence state
- first-party source
- verification date
- fallback behavior
- validation method

## Phase 0 audit gate

- [x] All current adapter outputs are listed by client.
- [x] Unverified mappings are not presented as stable contracts.
- [x] Claude Code and Cursor have initial first-party evidence.
- [x] Codex mappings are verified individually.
- [ ] Antigravity mappings are verified individually.
- [ ] Claude Desktop mappings are verified independently of Claude Code.
- [ ] Windsurf capability inventory is added.
- [ ] GitHub Copilot / VS Code capability inventory is added.

The unchecked items intentionally carry into Phase 1 and the client-definition
phase. They block a capability from becoming `stable`; they do not block
documentation of the current baseline.
