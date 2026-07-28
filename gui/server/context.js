import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolveKitRoot, resolveKitScopeDir} from '../../lib/kit-paths.js';
import {isWithinRoot, resolveForAuthorization, assertSafeProjectTarget as assertSafeProjectTargetShared} from '../../lib/security-boundary.js';
import {errorResponse, httpStatusForError} from '../../lib/interfaces/http/error-mapper.js';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createAppContext(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const projectRoot = options.projectRoot || path.resolve(__dirname, '../..');
  const kitRoot = options.kitRoot || resolveKitRoot(projectRoot);
  const manifestDeploymentService = createManifestDeploymentService({
    definitionsDir: options.definitionsDir || path.join(projectRoot, 'clients'),
    homeDir
  });

  function assertSafeProjectTarget(targetDir) {
    assertSafeProjectTargetShared({ targetDir, homeDir, projectRoot, kitRoot });
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
