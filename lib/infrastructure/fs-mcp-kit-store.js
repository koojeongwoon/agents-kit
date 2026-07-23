import fs from 'fs';
import path from 'path';
import { kitPaths } from '../kit-paths.js';
import { mcpEnvPath } from '../mcp-env.js';

function capture(filePath) {
  if (!fs.existsSync(filePath)) return { existed: false };
  const stat = fs.statSync(filePath);
  return { existed: true, content: fs.readFileSync(filePath), mode: stat.mode };
}

function restore(filePath, snapshot) {
  if (!snapshot.existed) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, snapshot.content);
  try { fs.chmodSync(filePath, snapshot.mode); } catch { /* best effort */ }
}

export function createFsMcpKitStore({ kitRoot }) {
  return Object.freeze({
    async transaction(scope, operation) {
      const scopedKit = kitPaths(kitRoot, scope.type, scope.projectName);
      const paths = Object.freeze({
        template: scopedKit.mcpTemplate,
        env: mcpEnvPath(kitRoot, scope.type, scope.projectName),
        envExample: scopedKit.envExample,
        resolved: scopedKit.mcpResolved
      });
      const snapshots = new Map(Object.values(paths).map(filePath => [filePath, capture(filePath)]));
      const transaction = Object.freeze({
        read() {
          return Object.freeze({
            template: fs.existsSync(paths.template)
              ? JSON.parse(fs.readFileSync(paths.template, 'utf8'))
              : { mcpServers: {} },
            envContent: fs.existsSync(paths.env) ? fs.readFileSync(paths.env, 'utf8') : '',
            envExampleContent: fs.existsSync(paths.envExample) ? fs.readFileSync(paths.envExample, 'utf8') : ''
          });
        },
        write(plan) {
          fs.mkdirSync(path.dirname(paths.template), { recursive: true });
          fs.writeFileSync(paths.template, `${JSON.stringify(plan.template, null, 2)}\n`);
          fs.writeFileSync(paths.env, plan.envContent, { mode: 0o600 });
          try { fs.chmodSync(paths.env, 0o600); } catch { /* best effort */ }
          fs.writeFileSync(paths.envExample, plan.envExampleContent);
        }
      });

      try {
        return await operation(transaction);
      } catch (error) {
        for (const [filePath, snapshot] of Array.from(snapshots.entries()).reverse()) restore(filePath, snapshot);
        throw error;
      }
    }
  });
}
