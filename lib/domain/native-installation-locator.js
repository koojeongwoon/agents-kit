import {validDeploymentLocator} from './deployment-locator.js';

// Native ownership has a different identity and proof source from generated
// files. A valid native locator must never pass the generated-locator contract.
export function validNativeInstallationLocator(value) {
  if(!value||value.type!=='native-installation'||value.strategy!=='native-source'
    ||typeof value.nativeId!=='string'||!value.nativeId||value.nativeId.length>255
    ||['.','..'].includes(value.nativeId)||/[\\/\u0000-\u001f\u007f]/.test(value.nativeId))return false;
  const {type,nativeId,...mapped}=value;
  const formats={instructions:['markdown'],skills:['directory'],agents:['toml','markdown'],mcpServers:['toml','toml-section','json','json-section']};
  if(!formats[value.assetKind]?.includes(value.format))return false;
  mapped.strategy=['instructions','mcpServers'].includes(value.assetKind)?'merge':'copy';
  if(value.assetKind==='mcpServers')mapped.format=value.format.startsWith('json')?'json':'toml-section';
  return validDeploymentLocator(mapped);
}
