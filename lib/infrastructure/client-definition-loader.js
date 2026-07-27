import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createClientDefinition } from '../domain/client-definition.js';
import { domainError } from '../domain/errors.js';

function parseDefinition(filePath) {
  try {
    const value = parseYaml(fs.readFileSync(filePath, 'utf8'), {
      maxAliasCount: 50,
      prettyErrors: true
    });
    return createClientDefinition(value);
  } catch (error) {
    if (error?.name === 'DomainError') throw error;
    throw domainError('CLIENT_DEFINITION_PARSE_ERROR', `Unable to parse ${path.basename(filePath)}`, {
      filePath,
      cause: error.message
    });
  }
}

export function loadClientDefinitions({ definitionsDir }) {
  if (!fs.existsSync(definitionsDir) || !fs.statSync(definitionsDir).isDirectory()) {
    throw domainError('CLIENT_DEFINITIONS_NOT_FOUND', 'Client definitions directory does not exist', {
      definitionsDir
    });
  }
  const files = fs.readdirSync(definitionsDir)
    .filter(name => /\.ya?ml$/i.test(name))
    .sort();
  const definitions = new Map();
  for (const name of files) {
    const filePath = path.join(definitionsDir, name);
    const definition = parseDefinition(filePath);
    if (definitions.has(definition.id)) {
      throw domainError('DUPLICATE_CLIENT_DEFINITION', `Duplicate client definition '${definition.id}'`, {
        filePath
      });
    }
    definitions.set(definition.id, definition);
  }
  return definitions;
}
