import path from 'node:path';
import {createAgentKitManifest} from '../../lib/domain/manifest.js';
import {skillCompatibilityDeclarationDigest} from '../../lib/domain/skill-distribution.js';
import {inspectSkillDistributionSources} from '../../lib/infrastructure/skill-distribution-source.js';

export function declareDistribution(f,{variantSource='',format='common',strategy='copy',exposure='shared',variants}={}) {
  const asset=f.raw.assets.skills[0];
  const inputs=variants||[{id:'common',source:variantSource,format,targets:[{clientId:'codex',surface:'cli'}]}];
  asset.definition={schemaVersion:3,format:'agent-skills',deployment:{schemaVersion:1,strategy},distribution:{schemaVersion:1,exposure,
    selection:inputs.flatMap(variant=>variant.targets.map(target=>({clientId:target.clientId,surface:target.surface,variantId:variant.id}))),
    variants:inputs.map(variant=>({id:variant.id,source:variant.source,format:variant.format||'common',compatibility:[]}))}};
  const normalized=createAgentKitManifest(f.raw).assets.skills[0],sources=inspectSkillDistributionSources(normalized,path.join(f.scopeRoot,asset.source));
  for(const [index,variant] of asset.definition.distribution.variants.entries())variant.compatibility=inputs[index].targets.map(target=>({clientId:target.clientId,surface:target.surface,versions:['0.0.1-test'],status:'compatible',
    review:{schemaVersion:1,basis:'author-review',treeDigest:sources.get(variant.id).descriptor.treeDigest,declarationDigest:skillCompatibilityDeclarationDigest(normalized)}}));
  f.write();return createAgentKitManifest(f.raw).assets.skills[0];
}
