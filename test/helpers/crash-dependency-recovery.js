import fs from 'node:fs';
import {coordinationStores} from './dependency-coordination-fixture.js';
import {planDependencyCoordinationRecovery,applyDependencyCoordinationRecovery} from '../../lib/application/dependency-coordination-service.js';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),stores=coordinationStores(input),plan=planDependencyCoordinationRecovery(stores);
applyDependencyCoordinationRecovery({...stores,plan,onPhase:phase=>{if(phase===input.recoveryPhase)process.kill(process.pid,'SIGKILL');}});
