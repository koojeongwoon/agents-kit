import {installationDigest,INSTALLABLE_RECEIPT_KINDS} from '../domain/installation-receipt.js';
import {installationDeclaration} from '../domain/installation-declaration.js';
import {dependencyPrerequisiteId,installedBindingDigest} from '../domain/dependency-reverse-index.js';
import {latestInstallationReceipts,observeInstallationReceipt} from './installation-receipt-service.js';
import {canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {buildScopedInstallationDeclarations,declarationAtOrigin,scopedDeclarationDigest,scopedTargetKey} from '../domain/scoped-installation-declaration.js';
import {selectSkillDistribution,skillDistributionDigest,skillSelectionDefinitionDigest} from '../domain/skill-distribution.js';
import {recordedSkillSelection} from './skill-distribution-deployment.js';

function declarationMatches({receipt,asset,manifest,node,contexts,scopes}) {
  if(receipt.schemaVersion===3&&manifest.schemaVersion!==3)return installationDigest(installationDeclaration(asset,manifest))===installationDigest(receipt.declaration);
  const expected=buildScopedInstallationDeclarations({contexts,scopes,sourceContextId:node.contextId,assetIds:[node.assetId]}).get(node.assetId),origin=expected.origins.find(origin=>origin.id===expected.subject.originId),recorded=declarationAtOrigin(receipt,origin);
  if(!recorded||scopedDeclarationDigest(expected)!==scopedDeclarationDigest(recorded))return false;
  if(receipt.schemaVersion===4)return installationDigest(expected)===installationDigest(recorded);
  // Old metadata cannot prove the v3 digest of noninstalled policy/harness
  // nodes. Those cases need an explicit v4 audit, never a guessed conversion.
  if(expected.dependencies.some(dependency=>!INSTALLABLE_RECEIPT_KINDS.includes(dependency.target.assetKind)))return null;
  return installationDigest(expected.dependencies.map(item=>scopedTargetKey(item.target)).sort())===installationDigest(recorded.dependencies.map(item=>scopedTargetKey(item.target)).sort());
}

// Sources supply the logical declaration; only an installed receipt supplies
// revision/locator/binding pins. Source text is never used as an installed body.
export function resolveScopedDeploymentPrerequisites({selection,contexts,scopes,definition,profile,clientVersion,nativeSkillPolicy,state,homeDir}) {
  const receipts=latestInstallationReceipts(state),blocked=[],entries=[],prerequisites=[];
  for(const node of selection.globalPrerequisites.filter(node=>INSTALLABLE_RECEIPT_KINDS.includes(node.kind))) {
    const scope=scopes[contexts.findIndex(context=>context.id===node.contextId)],manifest=contexts.find(context=>context.id===node.contextId).manifest;
    const sourceRoot=resolveForAuthorization(scope.scopeRoot),candidates=receipts.filter(receipt=>receipt.scope==='global'&&receipt.kitId===node.kitId&&receipt.sourceRoot===sourceRoot
      &&receipt.assetId===node.assetId&&receipt.assetKind===node.kind&&receipt.clientId===definition.id&&receipt.surface===profile.id&&receipt.configStore===profile.configStore
      &&receipt.locator.definitionDigest===canonicalDigest(definition));
    const observed=candidates.map(receipt=>({receipt,observation:observeInstallationReceipt({receipt,state,homeDir})}));
    const positive=observed.filter(item=>item.observation.status==='ownership-observed'&&item.observation.dependencyState==='revision-observed'&&item.observation.bindingDeclarationsState!=='unverified'&&[3,4].includes(item.receipt.schemaVersion));
    const asset=manifest.assets[node.kind].find(asset=>asset.id===node.assetId);
    let reason,receipt;
    if(positive.length!==1)reason='DEPENDENCY_INSTALLATION_PREREQUISITE_UNVERIFIED';
    else {
      receipt=positive[0].receipt;
      if(asset.kind==='skills'&&asset.definition?.schemaVersion===3) {
        const selected=selectSkillDistribution(asset,{clientId:definition.id,surface:profile.id,clientVersion,nativePolicyDigest:nativeSkillPolicy?.digest}),record=recordedSkillSelection(state,receipt);
        if(selected.status!=='selected'||selected.exposure!=='shared'||!record||record.definitionDigest!==(record.schemaVersion===1?skillDistributionDigest(asset.definition):skillSelectionDefinitionDigest(asset,selected))
          ||installationDigest(record.selection)!==installationDigest(selected))reason='SKILL_DISTRIBUTION_INSTALLATION_UNVERIFIED';
      }
      try {
        const matches=declarationMatches({receipt,asset,manifest,node,contexts,scopes});
        if(!reason&&matches!==true)reason=matches===null?'DEPENDENCY_INSTALLATION_DECLARATION_UNVERIFIED':'DEPENDENCY_INSTALLATION_DECLARATION_CHANGED';
      }catch{reason='DEPENDENCY_INSTALLATION_DECLARATION_UNVERIFIED';}
    }
    if(reason){blocked.push({reason,assetId:node.assetId,assetKind:node.kind,prerequisiteKey:node.key});entries.push({...node,status:'unverified',reason});continue;}
    const pin={kitId:receipt.kitId,sourceRoot:receipt.sourceRoot,assetId:receipt.assetId,assetKind:receipt.assetKind,clientId:receipt.clientId,surface:receipt.surface,configStore:receipt.configStore,
      revisionDigest:receipt.revisionDigest,locatorDigest:installationDigest(receipt.locator),bindingDigest:installedBindingDigest(receipt)};pin.id=dependencyPrerequisiteId(pin);prerequisites.push(pin);
    entries.push({...node,status:'ownership-observed',pin,nativeDiscoveryState:'unverified'});
  }
  const byKey=new Map(entries.filter(entry=>entry.pin).map(entry=>[entry.key,entry.pin]));
  const consumers=Object.fromEntries(Object.entries(selection.prerequisitesByAsset).map(([id,keys])=>[id,keys.flatMap(key=>byKey.has(key)?[byKey.get(key).id]:[])]));
  const toolRequirements=selection.graph.toolBindings.filter(binding=>byKey.has(binding.providerKey)).map(binding=>({providerId:byKey.get(binding.providerKey).id,toolId:binding.toolId}));
  return {blocked,entries,prerequisites,consumers,toolRequirements:[...new Map(toolRequirements.map(requirement=>[installationDigest(requirement),requirement])).values()]};
}
