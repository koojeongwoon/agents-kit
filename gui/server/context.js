import fs from 'fs';
import path from 'path';
import os from 'os';
import {fileURLToPath} from 'url';
import {buildResolvedMcpConfig} from '../../lib/mcp-env.js';
import {kitPaths, resolveKitRoot} from '../../lib/kit-paths.js';
import {getAdapters} from '../../lib/adapters/index.js';
import {isWithinRoot, resolveForAuthorization} from '../../lib/security-boundary.js';
import {errorResponse, httpStatusForError} from '../../lib/interfaces/http/error-mapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createAppContext() {
  const homeDir = os.homedir();
  const projectRoot = path.resolve(__dirname, '../../../');
  const kitRoot = resolveKitRoot(projectRoot);
  const kit = kitPaths(kitRoot);
  const permissionsFilePath = kit.permissionsFile;
  const approvedProjectRoots = new Set();

  function globalClientRoots() {
    return getAdapters({ scope: 'global', kitRoot }).map(adapter => adapter.detectedPath);
  }

  function readableRoots() {
    return [kitRoot, ...globalClientRoots(), ...approvedProjectRoots];
  }

  function isKnownLinkPair(source, target) {
    const adapters = [
      ...getAdapters({ scope: 'global', kitRoot }),
      ...Array.from(approvedProjectRoots).flatMap(projectPath => getAdapters({
        scope: 'project', kitRoot, customProjectPath: projectPath
      }))
    ];
    return adapters.some(adapter => adapter.getLinks().some(link => (
      path.resolve(link.source) === path.resolve(source) && path.resolve(link.target) === path.resolve(target)
    )));
  }

  function resolveMcpConfigForDeploy(scope = 'global', projectName = '') {
    const result = buildResolvedMcpConfig(kitRoot, scope, projectName);
    if (result.unresolved.length > 0) {
      console.warn(`MCP placeholders unresolved: ${result.unresolved.join(', ')}`);
      console.warn('Fill kit/.env (see kit/.env.example) then re-run apply.');
    }
    return result;
  }

  function assertSafeProjectTarget(targetDir) {
    const resolved = resolveForAuthorization(targetDir);
    const filesystemRoot = path.parse(resolved).root;
    const forbiddenRoots = [filesystemRoot, homeDir, projectRoot, kitRoot];
    if (forbiddenRoots.some(root => isWithinRoot(resolved, root) && isWithinRoot(root, resolved))) {
      throw new Error('agents-kit cannot be deployed into a filesystem root, home, repository, or kit directory');
    }
    if (isWithinRoot(resolved, kitRoot) || isWithinRoot(resolved, projectRoot)) {
      throw new Error('agents-kit cannot be deployed inside its own repository or kit directory');
    }
  }

  // Helper to resolve directory paths to their primary markdown document (e.g. SKILL.md, LOOP.md)
  function resolveDocumentPath(p) {
    if (!p) return p;
    try {
      let resolved = p;
      if (fs.existsSync(resolved)) {
        const lstat = fs.lstatSync(resolved);
        if (lstat.isSymbolicLink()) {
          const symlinkSource = fs.readlinkSync(resolved);
          resolved = path.resolve(path.dirname(resolved), symlinkSource);
        }
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          const skillDoc = path.join(resolved, 'SKILL.md');
          const loopDoc = path.join(resolved, 'LOOP.md');
          const readmeDoc = path.join(resolved, 'README.md');
          if (fs.existsSync(skillDoc)) return skillDoc;
          if (fs.existsSync(loopDoc)) return loopDoc;
          if (fs.existsSync(readmeDoc)) return readmeDoc;
          const files = fs.readdirSync(resolved);
          const mdFile = files.find(f => f.endsWith('.md'));
          if (mdFile) return path.join(resolved, mdFile);
        }
      }
      return resolved;
    } catch (e) {
      return p;
    }
  }

  // Helper to construct categorized client config list dynamically from Adapters
  function getClientConfigs(scope = 'global', customProjectPath = '', projectName = '') {
    const adapters = getAdapters({
      scope,
      kitRoot,
      targetDir: customProjectPath ? path.resolve(customProjectPath) : process.cwd(),
      projectName
    });

    return adapters.map(a => {
      const rawLinks = a.getCategorizedLinks();
      const formattedCategories = {};
      Object.keys(rawLinks).forEach(cat => {
        formattedCategories[cat] = rawLinks[cat].map(link => {
          let name = path.basename(link.source);
          if (link.source.endsWith('AGENTS.md')) name = 'AGENTS.md (Master Rules)';
          else if (link.source.endsWith('allowed-commands.json')) name = 'allowed-commands.json (Permissions)';
          else if (link.source.endsWith('hooks.json')) name = 'hooks.json (Event Hooks)';
          else if (link.source.includes('mcp-servers')) name = 'mcp-servers.json (MCP Config)';
          return { name, target: link.target, source: link.source };
        });
      });

      let icon = 'Sparkles';
      if (a.id === 'cursor') icon = 'Code2';
      if (a.id === 'codex') icon = 'Terminal';
      if (a.id.includes('claude')) icon = 'Bot';

      return { id: a.id, name: a.name, icon, detectedPath: a.detectedPath, categorizedLinks: formattedCategories };
    });
  }

  function exists(p) {
    try { return fs.existsSync(p); } catch (e) { return false; }
  }

  function existsBrokenSymlink(p) {
    try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
  }

  function checkSymlink(target, source) {
    try {
      const lstat = fs.lstatSync(target);
      if (lstat.isSymbolicLink()) {
        const linkSource = fs.readlinkSync(target);
        return path.resolve(path.dirname(target), linkSource) === path.resolve(source);
      }
    } catch (e) { return false; }
    return false;
  }

  function sendApiError(req, res, error) {
    res.status(httpStatusForError(error)).json(errorResponse(error, req.requestId));
  }

  return {
    homeDir, projectRoot, kitRoot, kit, permissionsFilePath, approvedProjectRoots,
    globalClientRoots, readableRoots, isKnownLinkPair, resolveMcpConfigForDeploy,
    assertSafeProjectTarget, resolveDocumentPath, getClientConfigs,
    exists, existsBrokenSymlink, checkSymlink, sendApiError
  };
}
