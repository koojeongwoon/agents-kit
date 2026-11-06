import fs from 'node:fs';
import crypto from 'node:crypto';
import {createManifestDeploymentService} from '../../lib/application/manifest-deployment-service.js';

const input=JSON.parse(process.argv[2]),service=createManifestDeploymentService({homeDir:input.homeDir,definitionsDir:input.definitionsDir,clock:()=>1000,
  binaryObserver:()=>({binaryPath:input.binaryPath,sha256:crypto.createHash('sha256').update(fs.readFileSync(input.binaryPath)).digest('hex')}),
  nativeInventoryObserver:async request=>{if(request.serverNames.length)request.authorizeDiscovery(input.response);return structuredClone(input.response);},
  onDeploymentPhase:phase=>{if(phase===input.phase)process.kill(process.pid,'SIGKILL');}});
await service.resumeSavedPlan(input.saved);
