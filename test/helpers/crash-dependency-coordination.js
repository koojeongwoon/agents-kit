import fs from 'node:fs';
import {coordinationRequest,executeProjectFixture} from './dependency-coordination-fixture.js';
import {planDependencyCoordination,executeDependencyCoordination} from '../../lib/application/dependency-coordination-service.js';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),request=coordinationRequest(input),plan=planDependencyCoordination(request);
executeDependencyCoordination({...request,plan,executeProject:context=>executeProjectFixture(input,context,{phase:input.phase}),onPhase:phase=>{if(phase===input.phase)process.kill(process.pid,'SIGKILL');}});
