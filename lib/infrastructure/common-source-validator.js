import fs from 'node:fs';
import path from 'node:path';
import {parseDocument} from 'yaml';
import {domainError} from '../domain/errors.js';
import {readImportSource} from './import-source-reader.js';
import {inspectSkillDistributionSources} from './skill-distribution-source.js';
import {selectSkillDistribution,skillDistributionDigest} from '../domain/skill-distribution.js';
import {validateNativeSkillInterface} from '../adapters/native-skill-interface.js';

function fail(asset, code) {
  throw domainError(code, 'Common source does not satisfy its declared format', {assetId: asset.id});
}

function readText(asset, file) {
  if (!fs.lstatSync(file).isFile()) fail(asset, 'COMMON_SOURCE_FILE_REQUIRED');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(file)); }
  catch { fail(asset, 'INVALID_COMMON_SOURCE_ENCODING'); }
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail(asset, 'INVALID_COMMON_SOURCE_TEXT');
  if (/<!--\s*agents-kit:/i.test(text)) fail(asset, 'COMMON_SOURCE_RESERVED_MARKER');
  if (/(?:\b(?:sk-(?:ant-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+)/i.test(text)) fail(asset, 'LITERAL_SECRET');
  return text.replaceAll('\r\n', '\n');
}

// Opt-in validation leaves existing native source-only manifests compatible.
export function validateCommonSource(asset, source, {bounded = false,distributionSelection,scopeRoot} = {}) {
  if (!['instructions', 'skills'].includes(asset.kind) || asset.definition === undefined) return;
  if(asset.kind==='skills'&&asset.definition.schemaVersion===3) {
    if(distributionSelection&&skillDistributionDigest(distributionSelection)!==skillDistributionDigest(selectSkillDistribution(asset,distributionSelection)))fail(asset,'SKILL_DISTRIBUTION_SELECTION_CHANGED');
    if(distributionSelection?.status==='blocked')return;
    const variants=inspectSkillDistributionSources(asset,source,{scopeRoot,...(distributionSelection?{variantIds:[distributionSelection.variantId]}:{})});
    for(const {variant,source:selected,descriptor,files} of variants.values()) {
      if(variant.format==='common')validateCommonSource({...asset,definition:{schemaVersion:1,format:'agent-skills'}},selected,{bounded:true});
      else if(distributionSelection)validateNativeSkillInterface({asset,selection:distributionSelection,files});
      if(distributionSelection&&descriptor.treeDigest!==distributionSelection.review.treeDigest)fail(asset,'SKILL_COMPATIBILITY_SOURCE_CHANGED');
    }
    return;
  }
  if (asset.kind === 'instructions') {
    const text = readText(asset, source);
    // Activation frontmatter and Antigravity includes do not share Codex semantics.
    if (text.startsWith('---\n') || /@\[[^\]]*\]\(/.test(text)) fail(asset, 'COMMON_INSTRUCTIONS_EXTENSION_UNSUPPORTED');
    return;
  }
  if (!fs.lstatSync(source).isDirectory()) fail(asset, 'COMMON_SKILL_DIRECTORY_REQUIRED');
  if (bounded) {
    try {readImportSource({source, authorizedRoot: source, kind: 'skills'});} catch (error) {
      if (error.name === 'DomainError') throw error;
      fail(asset, 'COMMON_SKILL_UNSAFE_ENTRY');
    }
  }
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) fail(asset, 'COMMON_SKILL_UNSAFE_ENTRY');
      // Client-specific metadata can alter invocation/tool policy outside SKILL.md.
      if (directory === source && entry.name === 'agents') fail(asset, 'COMMON_SKILL_CLIENT_EXTENSION_UNSUPPORTED');
      if (entry.isDirectory()) walk(path.join(directory, entry.name));
    }
  };
  walk(source);
  const skillFile = path.join(source, 'SKILL.md');
  if (!fs.existsSync(skillFile)) fail(asset, 'COMMON_SKILL_FILE_REQUIRED');
  const text = readText(asset, skillFile);
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match || !match[2].trim()) fail(asset, 'INVALID_SKILL_FRONTMATTER');
  let metadata;
  try {
    const document = parseDocument(match[1], {uniqueKeys: true});
    if (document.errors.length || document.warnings.length) fail(asset, 'INVALID_SKILL_FRONTMATTER');
    metadata = document.toJS({maxAliasCount: 0});
  } catch { fail(asset, 'INVALID_SKILL_FRONTMATTER'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || Object.keys(metadata).some(key => !['name', 'description'].includes(key))
    || metadata.name !== asset.id || typeof metadata.description !== 'string' || !metadata.description.trim()) {
    fail(asset, 'INVALID_SKILL_FRONTMATTER');
  }
}
