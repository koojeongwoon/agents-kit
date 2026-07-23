import fs from 'fs';
import path from 'path';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SAFE_SKILL_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

function assertSegment(value, label) {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid skills.sh ${label}`);
  }
  return value;
}

export function parseSkillsShLocator(rawLocator) {
  const locator = String(rawLocator || '').trim();
  if (!locator) throw new Error('skills.sh URL or owner/repo@skill is required');

  let owner;
  let repository;
  let slug;

  if (/^https?:\/\//i.test(locator)) {
    const url = new URL(locator);
    if (!['skills.sh', 'www.skills.sh'].includes(url.hostname.toLowerCase())) {
      throw new Error('Only skills.sh skill URLs are accepted');
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments.length !== 3) {
      throw new Error('Use a skills.sh skill page URL such as https://skills.sh/owner/repo/skill');
    }
    [owner, repository, slug] = segments;
  } else {
    const match = locator.match(/^([^/@\s]+)\/([^/@\s]+)@([^/@\s]+)$/);
    if (!match) throw new Error('Use owner/repo@skill or a skills.sh skill page URL');
    [, owner, repository, slug] = match;
  }

  assertSegment(owner, 'owner');
  assertSegment(repository, 'repository');
  if (!SAFE_SKILL_SEGMENT.test(slug) || slug === '.' || slug === '..') {
    throw new Error('Invalid skills.sh skill name');
  }
  return {
    owner,
    repository,
    slug,
    directoryName: slug.replace(/:/g, '-'),
    source: `${owner}/${repository}`,
    id: `${owner}/${repository}/${slug}`
  };
}

export function validateDownloadedSkill(skillDir, { maxFiles = 500, maxBytes = 20 * 1024 * 1024 } = {}) {
  const root = path.resolve(skillDir);
  const skillMd = path.join(root, 'SKILL.md');
  if (!fs.existsSync(skillMd) || !fs.lstatSync(skillMd).isFile()) {
    throw new Error('Downloaded skill does not contain a regular SKILL.md file');
  }

  let files = 0;
  let bytes = 0;
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`Downloaded skill contains a forbidden symlink: ${entry.name}`);
      if (stat.isDirectory()) visit(candidate);
      else if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
        if (files > maxFiles) throw new Error(`Downloaded skill exceeds ${maxFiles} files`);
        if (bytes > maxBytes) throw new Error('Downloaded skill exceeds the 20 MB safety limit');
      } else {
        throw new Error(`Downloaded skill contains an unsupported filesystem entry: ${entry.name}`);
      }
    }
  };
  visit(root);

  const frontmatter = fs.readFileSync(skillMd, 'utf8').match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter || !/^name\s*:/m.test(frontmatter[1]) || !/^description\s*:/m.test(frontmatter[1])) {
    throw new Error('Downloaded SKILL.md must contain name and description frontmatter');
  }
  return { files, bytes, skillMd };
}

export function findDownloadedSkill(rootDir, slug) {
  const matches = [];
  const visit = (current, depth = 0) => {
    if (depth > 8) return;
    const skillMd = path.join(current, 'SKILL.md');
    if (fs.existsSync(skillMd) && fs.lstatSync(skillMd).isFile()) matches.push(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name)) {
        visit(path.join(current, entry.name), depth + 1);
      }
    }
  };
  visit(path.resolve(rootDir));
  const exact = matches.find(candidate => path.basename(candidate) === slug);
  if (exact) return exact;
  if (matches.length === 1) return matches[0];
  throw new Error(`Could not identify downloaded skill '${slug}'`);
}
