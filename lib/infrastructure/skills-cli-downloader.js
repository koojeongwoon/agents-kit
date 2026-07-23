import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { findDownloadedSkill, validateDownloadedSkill } from '../skills-sh.js';
import { domainError } from '../domain/errors.js';

function resolveNpxExecutable() {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const candidates = [
    path.join(path.dirname(process.execPath), executable),
    process.platform === 'darwin' ? `/opt/homebrew/bin/${executable}` : '',
    process.platform === 'darwin' ? `/usr/local/bin/${executable}` : ''
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || executable;
}

function runSkillsCli({ source, slug, workingDirectory }) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveNpxExecutable(), [
      '--yes', 'skills@1.5.20', 'add', source,
      '--skill', slug, '--agent', 'universal', '--yes', '--copy'
    ], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        HOME: workingDirectory,
        USERPROFILE: workingDirectory,
        DO_NOT_TRACK: '1',
        DISABLE_TELEMETRY: '1',
        CI: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => `${current}${chunk}`.slice(-100000);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(domainError('EXTERNAL_UNAVAILABLE', 'skills.sh download timed out after 120 seconds'));
    }, 120000);
    child.on('error', error => {
      clearTimeout(timeout);
      reject(domainError('EXTERNAL_UNAVAILABLE', `Unable to start the official skills CLI: ${error.message}`));
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(domainError('EXTERNAL_UNAVAILABLE', (stderr || stdout || `skills CLI exited with code ${code}`).trim()));
    });
  });
}

export function createSkillsCliDownloader() {
  return Object.freeze({
    async download(skill) {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kit-skill-'));
      try {
        await runSkillsCli({ source: skill.source, slug: skill.slug, workingDirectory: temporaryDirectory });
        const downloadedPath = findDownloadedSkill(temporaryDirectory, skill.slug);
        const validation = validateDownloadedSkill(downloadedPath);
        return Object.freeze({
          path: downloadedPath,
          files: validation.files,
          bytes: validation.bytes,
          cleanup: () => {
            if (fs.existsSync(temporaryDirectory)) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
          }
        });
      } catch (error) {
        if (fs.existsSync(temporaryDirectory)) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }
    }
  });
}
