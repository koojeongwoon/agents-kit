import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {validNativeOwner} from '../domain/native-installation.js';
import {validNativeInstallationLocator} from '../domain/native-installation-locator.js';
import {installationDeclaration} from '../domain/installation-declaration.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {readPathImage,imageSummary} from '../infrastructure/path-image.js';
import {boundedRead} from '../infrastructure/import-source-reader.js';
import {kitSourcePath} from '../infrastructure/kit-source-transaction.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {canonicalNativeMcpUnit} from '../adapters/mcp/native-installation.js';

const fail=code=>{throw domainError(code,'Native installed evidence requires its original owner, path and unchanged baseline');};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function selected(bytes,locator) {
  if(locator.assetKind!=='mcpServers')return bytes;
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('NATIVE_MCP_TARGET_UNSUPPORTED');}
  return canonicalNativeMcpUnit(text,{nativeId:locator.nativeId,format:locator.format});
}

export function describeNativeInstallationResource(entry) {
  const locator={schemaVersion:1,type:'native-installation',kitId:entry.manifest.kit.id,assetId:entry.asset.id,assetKind:entry.record.kind,
    clientId:entry.clientId,surface:entry.profile.id||'default',scope:entry.input.scope,configStore:entry.configStore,
    definitionDigest:canonicalDigest(entry.definition),capabilityId:entry.capability.id,pathTemplate:entry.capability.path,
    targetBase:entry.target,nativeId:entry.record.nativeId,strategy:'native-source',format:entry.record.format};
  if(!validNativeInstallationLocator(locator))fail('NATIVE_RECEIPT_PROFILE_UNVERIFIED');
  return {sourceRoot:resolveForAuthorization(entry.scopeRoot),kitId:locator.kitId,assetId:locator.assetId,assetKind:locator.assetKind,
    clientId:locator.clientId,surface:locator.surface,scope:locator.scope,configStore:locator.configStore,locator,
    declaration:installationDeclaration(entry.asset,entry.manifest)};
}

function provenOwner(state,target,descriptor) {
  const record=state.managed[target],owner=record?.nativeSource||record?.owners?.[descriptor.assetId]?.nativeSource;
  if(!validNativeOwner(owner))return null;
  const locator=descriptor.locator;
  if(['kitId','assetId','clientId','surface','scope','configStore','nativeId','format','targetBase'].some(key=>owner[key]!==locator[key])
    ||owner.kind!==locator.assetKind||resolveForAuthorization(owner.sourceRoot)!==descriptor.sourceRoot)return null;
  const expected=locator.assetKind==='skills'?path.join(locator.targetBase,owner.relative):locator.targetBase;if(target!==expected)return null;
  const transaction=state.transactions.find(item=>item.id===record.transactionId&&item.type==='apply'&&item.status==='committed');
  const operation=transaction?.operations?.find(item=>canonicalDigest(item.managedAfter?.[target]||(item.target===target?item.afterManaged:null))===canonicalDigest(record));
  return operation?{record,owner}:null;
}

export function nativeInstallationProjection({descriptor,state,homeDir,targetRoot=homeDir}) {
  if(!validNativeInstallationLocator(descriptor.locator))fail('NATIVE_RECEIPT_PROFILE_UNVERIFIED');
  const root=resolveForAuthorization(descriptor.scope==='global'?homeDir:targetRoot),locator=descriptor.locator;
  const matching=Object.keys(state.managed).sort().map(target=>({target,value:provenOwner(state,target,descriptor)})).filter(item=>item.value);
  if(!matching.length)fail('INSTALLATION_OWNERSHIP_UNAVAILABLE');
  const proofs=[];let directories=[];
  for(const {target,value:{record,owner}} of matching) {
    const info=fs.lstatSync(target);if(!info.isFile()||info.nlink!==1)fail('INSTALLATION_CONTENT_DRIFT');
    const actual=readPathImage(target,{authorizedRoot:root});if(actual.kind!=='file')fail('INSTALLATION_CONTENT_DRIFT');
    const baselinePath=kitSourcePath(descriptor.sourceRoot,`${owner.lastApplied.directory}/${owner.lastApplied.file.path}`),baselineInfo=fs.lstatSync(baselinePath);
    if(!baselineInfo.isFile()||baselineInfo.nlink!==1)fail('NATIVE_LAST_APPLIED_UNAVAILABLE');
    const baseline=boundedRead(baselinePath);
    if(hash(baseline.bytes)!==owner.lastApplied.file.sha256||baseline.mode!==owner.lastApplied.file.mode)fail('NATIVE_LAST_APPLIED_UNAVAILABLE');
    const current=selected(Buffer.from(actual.content,'base64'),locator),previous=selected(baseline.bytes,locator);
    if(!current||!previous||hash(current)!==hash(previous)||locator.assetKind!=='mcpServers'&&actual.mode!==owner.lastApplied.file.mode)fail('INSTALLATION_CONTENT_DRIFT');
    proofs.push({target,managedTransactionId:record.transactionId,mode:actual.mode,contentHash:hash(current),nativeOwnerDigest:installationDigest(owner)});
  }
  if(locator.assetKind==='skills') {
    const tree=readPathImage(locator.targetBase,{authorizedRoot:root});if(tree.kind!=='directory')fail('INSTALLATION_CONTENT_DRIFT');
    const summary=imageSummary(tree),files=summary.entries.filter(item=>item.kind==='file');
    if(installationDigest(files.map(item=>path.join(locator.targetBase,item.path)).sort())!==installationDigest(proofs.map(item=>item.target).sort()))fail('UNTRACKED_INSTALLATION_CONTENT');
    if(files.some(item=>{const proof=proofs.find(value=>value.target===path.join(locator.targetBase,item.path));return proof.contentHash!==item.sha256||proof.mode!==item.mode;}))fail('INSTALLATION_CONTENT_DRIFT');
    directories=summary.entries.filter(item=>item.kind==='directory').map(({path,mode})=>({path,mode}));
  }
  return {proofs,directories};
}
