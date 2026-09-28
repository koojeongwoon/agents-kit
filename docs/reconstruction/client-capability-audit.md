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
skills, config, MCP, subagent, and hook mappings. As of CA01 (2026-09-27), the
schema 2 contract uses `.agents/skills`, `mcp_servers` config sections and
standalone `.codex/agents/{assetId}.toml` files. Project instructions use
repository `AGENTS.md`. CLI and desktop share a logical store but do not share
runtime evidence. No runtime profile is currently activated. Existing agent
config sections are preserved; automatic migration is deferred to CA03.

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

Audit status: `verified per capability`.

The definition uses `.cursor/rules/{assetId}.mdc` for project Rules and treats
global User Rules as UI-only. The deprecated `.cursorrules` path is not an
automatic deployment target. Project and global Skills use `.cursor/skills`,
and MCP uses `.cursor/mcp.json` at the corresponding scope. Custom Agent file
deployment remains unverified rather than inferring a path.

Evidence:

- <https://docs.cursor.com/context/rules>
- <https://docs.cursor.com/context/skills>
- <https://docs.cursor.com/context/model-context-protocol>

### Google Antigravity

Current Agent Kit outputs include plugin-scoped rules, hooks, skills, agents,
loops, plugin metadata, MCP configuration, permissions, and memory.

Audit status: `verified per capability`.

Antigravity CLI reads project `AGENTS.md`, project Skills from
`.agents/skills`, and project MCP servers from `.agents/mcp_config.json`.
Global instructions use `~/.gemini/GEMINI.md`. CA01 (2026-09-27) corrects global
MCP to `~/.gemini/config/mcp_config.json`. CLI Skills remain in
`~/.gemini/antigravity-cli/skills`; app/IDE Skills use `~/.gemini/config/skills`.
CA04-6 found CLI 1.2.12 actually consumes the shared config path too; the CLI
surface override reflects that measured result while the documented baseline remains.
CLI/app Agent contracts use `.agents/agents/*.md` and `~/.gemini/config/agents`.
The app MCP file path and IDE Agent support are not inferred from CLI support.
No schema 2 runtime profile is currently activated; the old MCP file is not
moved or deleted. Its ownership-based migration belongs to CA03.

Evidence:

- <https://antigravity.google/docs/mcp>
- <https://antigravity.google/docs/skills>
- <https://antigravity.google/docs/subagents>
- <https://antigravity.google/docs/rules/>

### Claude Desktop

Current Agent Kit outputs include desktop MCP configuration plus Agent Kit
compatibility files for instructions, skills, loops, and memory.

Audit status: `unverified`.

Claude Desktop MCP configuration must be audited separately from Claude Code.
No Claude Code capability should be inherited implicitly by Claude Desktop.

## Target clients not yet represented

The reconstruction roadmap also requires separate definitions for:

- GitHub Copilot / VS Code

VS Code must be completed only after a first-party capability audit. VS Code settings,
VS Code MCP configuration, Copilot instructions, prompts, agents, and skills
must remain separate asset contracts even when they share a workspace.

### Windsurf

Audit status: `verified per capability`.

Windsurf reads project instructions from `AGENTS.md`, project Skills from
`.windsurf/skills`, and Workflows from `.windsurf/workflows`. Global Skills and
Workflows use their documented `~/.codeium/windsurf` locations. MCP is a global
configuration in `~/.codeium/windsurf/mcp_config.json`; the undocumented
`.windsurf/mcp.json` mapping is not used.

Evidence:

- <https://docs.windsurf.com/windsurf/cascade/memories>
- <https://docs.windsurf.com/windsurf/cascade/skills>
- <https://docs.windsurf.com/windsurf/cascade/workflows>
- <https://docs.windsurf.com/windsurf/cascade/mcp>

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
- [x] Antigravity mappings are verified individually.
- [ ] Claude Desktop mappings are verified independently of Claude Code.
- [x] Windsurf capability inventory is added.
- [ ] GitHub Copilot / VS Code capability inventory is added.

The unchecked items intentionally carry into Phase 1 and the client-definition
phase. They block a capability from becoming `stable`; they do not block
documentation of the current baseline.

## CA04-1 installed CLI observations (2026-09-27)

Documentation evidence above is distinct from runtime support.
[Measured results](phase-ca04-1-cli-recognition.md) record Codex 0.145.0 skill
discovery and direct client MCP invocation, and Antigravity 1.2.11 global MCP
listing on macOS arm64. Project MCP and subagent absence from Antigravity list
commands is not proof of unsupported runtime behavior. No production runtime
profile has been promoted. Follow-up [CA04-2 observations](phase-ca04-2-cli-model-use.md)
verify project instructions/Skills with native authentication and Codex stdio MCP
model use. [CA04-4](phase-ca04-4-antigravity-mcp-use.md) adds Antigravity 1.2.12
project stdio MCP model use under an explicitly approved temporary permission.
[CA04-5](phase-ca04-5-cli-agent-use.md) records custom Agent marker lifecycle
and Antigravity role invocation; the latter's update repeat used an unexpected
`schedule` tool and was rejected. Direct child completion remains unconfirmed
in the observed public streams; production profiles remain inactive.

## CA04-6 direct completion and global Skill observations (2026-09-27)

[Evidence](phase-ca04-6-agent-completion-global-skills.md) confirms Codex project
Agent completion by subscribing to the observed native child without loading
history. Both CLI global Skills pass the five-stage lifecycle; Antigravity
requires the corrected shared config path. Its original documented CLI path
failed discovery during model use. Production runtimeEvidence remains empty.


## CA04-7 reviewed CLI activation (2026-09-27)

[CA04-7](phase-ca04-7-cli-activation.md) supersedes the historical empty-profile
status above for nine CLI slices only. Exact native binary hash/version on darwin
arm64 gates plans and apply. Basic typed stdio MCP excludes environment forwarding;
basic typed Codex Agent roles exclude native defaults. Antigravity Agent, app/IDE,
other builds/platforms and unverified global resources remain blocked.
