import {installationDigest,validInstallationReceipt} from './installation-receipt.js';
import {validSkillDistribution,skillDistributionDigest,validNativeSkillDeclaration} from './skill-distribution.js';
import {variantSourceId} from './managed-skill-source.js';

const HASH=/^[a-f0-9]{64}$/;
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));

export function validSkillSelection(selection) {
  if(!fields(selection,['schemaVersion','clientId','surface','clientVersion','exposure','nativeUseState','fulfilled','variantId','source','format','review','reviewDigest','compatibilityState','status',...([2,3].includes(selection?.schemaVersion)?['sourceBase','sourceRevision']:[]),...(selection?.schemaVersion===3?['native','nativePolicyDigest']:[])])
    ||![1,2,3].includes(selection.schemaVersion)||selection.status!=='selected'||selection.format!==(selection.schemaVersion===3?'native':'common')||selection.exposure!=='shared'
    ||selection.nativeUseState!=='unverified'||selection.fulfilled!==false||selection.compatibilityState!=='author-reviewed')return false;
  const {variantId,source,format,clientId,surface,clientVersion,review}=selection;
  const native=selection.schemaVersion===3,managed=selection.schemaVersion===2||native&&selection.sourceBase==='kit';
  if(native&&(!validNativeSkillDeclaration(selection.native)||selection.native.clientId!==clientId||!HASH.test(selection.nativePolicyDigest||'')||!['kit','asset'].includes(selection.sourceBase)||!managed&&selection.sourceRevision!==undefined))return false;
  if(managed&&(selection.sourceBase!=='kit'||!fields(selection.sourceRevision,['id','revisionId'])||!/^variant-[a-f0-9]{56}$/.test(selection.sourceRevision.id||'')||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(selection.sourceRevision.revisionId||'')))return false;
  return validSkillDistribution({schemaVersion:1,exposure:'shared',selection:[{clientId,surface,variantId}],variants:[{id:variantId,source,format,...(native?{native:selection.native}:{}),
    compatibility:[{clientId,surface,versions:[clientVersion],status:'compatible',review}]}]})
    &&selection.reviewDigest===skillDistributionDigest({variantId,clientId,surface,version:clientVersion,review,...(managed?{sourceBase:selection.sourceBase,sourceRevision:selection.sourceRevision,source}:{}),...(native?{native:selection.native,nativePolicyDigest:selection.nativePolicyDigest,sourceBase:selection.sourceBase,source}:{})});
}

export function validSkillSelectionReceipt(value,receipts) {
  if(!fields(value,['schemaVersion','receiptDigest','definitionDigest','selection'])||![1,2].includes(value.schemaVersion)||!HASH.test(value.receiptDigest||'')
    ||!HASH.test(value.definitionDigest||'')||!validSkillSelection(value.selection))return false;
  return receipts.some(receipt=>validInstallationReceipt(receipt)&&receipt.assetKind==='skills'&&receipt.locator.type!=='native-installation'
    &&(!value.selection.sourceRevision||value.selection.sourceRevision.id===variantSourceId(receipt.assetId,value.selection.variantId))
    &&receipt.clientId===value.selection.clientId&&receipt.surface===value.selection.surface&&installationDigest(receipt)===value.receiptDigest);
}

export function validTransactionSkillSelections(transaction) {
  const records=transaction.skillSelections;
  return records===undefined||Array.isArray(records)&&records.length<=4096&&new Set(records.map(record=>record?.receiptDigest)).size===records.length
    &&records.every(record=>validSkillSelectionReceipt(record,transaction.installationReceipts||[]));
}
