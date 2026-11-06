#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {replayVerificationReport} from '../lib/adapters/verification/recorded-report.js';
import {verificationComponentHashes} from './client-verification/report.mjs';

const options = {}, argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 2) {
  if (!['--input', '--output'].includes(argv[index]) || !argv[index + 1]) throw new Error('Use --input <receipt.json> --output <new-report.json>');
  options[argv[index].slice(2)] = argv[index + 1];
}
if (!options.input) throw new Error('A recorded receipt is required; this command never starts a client');
const source = fs.readFileSync(path.resolve(options.input));
if (source.length > 1024 * 1024) throw new Error('Receipt exceeds the public evidence limit');
const report = {...replayVerificationReport(JSON.parse(source)),
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), verificationComponentHashes: verificationComponentHashes()};
const output = JSON.stringify(report, null, 2) + '\n';
if (options.output) fs.writeFileSync(path.resolve(options.output), output, {flag: 'wx', mode: 0o600});
else process.stdout.write(output);
// Successful replay can describe a failed verification; it never activates support.
