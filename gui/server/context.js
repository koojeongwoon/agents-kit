import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolveKitRoot, resolveKitScopeDir} from '../../lib/kit-paths.js';
import {isWithinRoot, resolveForAuthorization} from '../../lib/security-boundary.js';
import {errorResponse, httpStatusForError} from '../../lib/interfaces/http/error-mapper.js';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createAppContext() {
  const homeDir = os.homedir();
  const projectRoot = path.resolve(__dirname, '../../../');
  const kitRoot = resolveKitRoot(projectRoot);
  const manifestDeploymentService = createManifestDeploymentService({
    definitionsDir: path.join(projectRoot, 'clients'),
    homeDir
  });

  function assertSafeProjectTarget(targetDir) {
    const resolved = resolveForAuthorization(targetDir);
    const filesystemRoot = path.parse(resolved).root;
    const forbiddenRoots = [filesystemRoot, homeDir, projectRoot, kitRoot];
    if (forbiddenRoots.some(root => isWithinRoot(resolved, root) && isWithinRoot(root, resolved))) {
      throw new Error('Agent Kit cannot deploy into a filesystem root, home, repository, or Kit directory');
    }
    if (isWithinRoot(resolved, kitRoot) || isWithinRoot(resolved, projectRoot)) {
      throw new Error('Agent Kit cannot deploy inside its own repository or Kit directory');
    }
  }

  function sendApiError(req, res, error) {
    res.status(httpStatusForError(error)).json(errorResponse(error, req.requestId));
  }

  return {
    homeDir,
    projectRoot,
    kitRoot,
    manifestDeploymentService,
    resolveKitScopeDir,
    assertSafeProjectTarget,
    sendApiError
  };
}
