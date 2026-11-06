import path from 'node:path';
import {selectClientSurface} from '../domain/client-definition.js';
import {installationPhysicalKey,installationDigest} from '../domain/installation-receipt.js';
import {skillSelectionDefinitionDigest} from '../domain/skill-distribution.js';
import {validSkillSelectionReceipt} from '../domain/skill-selection-receipt.js';

// Known roots are evidence of possible readers, never proof of runtime loading
// or an exhaustive inventory of user-defined discovery locations.
export function skillDistributionReviews({plan,definitions,homeDir,targetRoot,scope}) {
  return [...plan.operations,...plan.blocked].filter(item=>item.skillSelection).map(planned=>{
    const root=scope==='global'?homeDir:targetRoot,resolve=template=>path.resolve(root,template.startsWith('~/')?template.slice(2):template);
    const target=resolve(planned.target),readers=new Map();
    for(const definition of definitions.values())for(const profile of definition.schemaVersion===2?definition.surfaces:[selectClientSurface(definition)]) {
      const add=via=>{const value={clientId:definition.id,surface:profile.id||null,via};readers.set(JSON.stringify([value.clientId,value.surface,via]),value);};
      for(const capability of profile.capabilities.filter(capability=>capability.assetKind==='skills'&&capability.scope===scope&&capability.path)) {
        if(resolve(capability.path.replaceAll('{assetId}',planned.assetId))===target)add('capability');
        for(const extra of capability.discovery?.paths||[])if(resolve(extra.includes('{assetId}')?extra.replaceAll('{assetId}',planned.assetId):path.join(extra,planned.assetId))===target)add('discovery');
      }
      for(const rule of profile.inventoryRules?.rules||[])if(rule.assetKind==='skills')for(const entry of rule.roots||[])
        if(entry.scope===scope&&path.join(resolve(entry.path),planned.assetId)===target)add('inventory');
    }
    return {assetId:planned.assetId,clientId:planned.clientId,surface:planned.targetProfile.surface,selection:structuredClone(planned.skillSelection),
      exposure:{schemaVersion:1,target,coverage:'known-roots-only',additionalDiscoveryState:'unverified',isolationState:'unverified',
        readers:[...readers.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}};
  });
}

export function describeSkillSelections({manifest,locators,desired}) {
  return locators.flatMap(locator=>{
    const item=desired.find(item=>item.planned.assetId===locator.assetId&&item.planned.clientId===locator.clientId&&item.planned.targetProfile.surface===locator.surface);
    if(!item?.planned.skillSelection)return [];
    const asset=manifest.assets.skills.find(asset=>asset.id===locator.assetId);
    return [{schemaVersion:2,physicalKey:installationPhysicalKey(locatorDescriptor(locator,manifest)),definitionDigest:skillSelectionDefinitionDigest(asset,item.planned.skillSelection),selection:structuredClone(item.planned.skillSelection)}];
  });
}
const locatorDescriptor=(locator,manifest)=>({locator,kitId:manifest.kit.id,assetKind:locator.assetKind,assetId:locator.assetId,clientId:locator.clientId,surface:locator.surface,scope:locator.scope,configStore:locator.configStore});

export function recordedSkillSelection(state,receipt) {
  const digest=installationDigest(receipt);
  for(const transaction of [...state.transactions].reverse())if(transaction.type==='apply'&&transaction.status==='committed') {
    if(!(transaction.installationReceipts||[]).some(candidate=>installationDigest(candidate)===digest))continue;
    const record=transaction.skillSelections?.find(record=>record.receiptDigest===digest);
    return record&&validSkillSelectionReceipt(record,transaction.installationReceipts)?record:null;
  }
  return null;
}
