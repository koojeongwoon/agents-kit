import path from 'node:path';
import {parse} from 'yaml';
import {boundedRead} from './import-source-reader.js';
import {authorizeImagePath} from './path-image.js';
import {createNativePrerequisiteDefinition} from '../domain/native-prerequisite-definition.js';
import {domainError} from '../domain/errors.js';

// Auxiliary discovery evidence preserves base client installation digests.
export function loadNativePrerequisiteDefinition({definitionsDir,clientId,surface,configStore}) {
  if(![clientId,surface,configStore].every(value=>typeof value==='string'&&/^[a-z][a-z0-9._-]{0,63}$/.test(value)))throw domainError('NATIVE_PREREQUISITE_DEFINITION_UNVERIFIED','A bounded client profile is required');
  const root=path.resolve(definitionsDir,'native-prerequisites'),file=path.join(root,`${clientId}-${surface}.yaml`);authorizeImagePath(file,root);
  let raw;try{raw=parse(boundedRead(file).bytes.toString('utf8'),{maxAliasCount:50});}catch{throw domainError('NATIVE_PREREQUISITE_DEFINITION_UNVERIFIED','Native prerequisites require a reviewed protocol definition');}
  return createNativePrerequisiteDefinition(raw,{clientId,surface,configStore});
}
