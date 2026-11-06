import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {boundedRead} from './import-source-reader.js';
import {installationDigest} from '../domain/installation-receipt.js';
import {domainError} from '../domain/errors.js';

const fail=()=>{throw domainError('NATIVE_PREREQUISITE_CONTEXT_UNVERIFIED','Native prerequisites require unchanged ordinary configuration files and known layers');};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&value.length<=4096&&!/[\\\u0000-\u001f\u007f]/.test(value);
function systemPath(file) {
  // /etc is an OS alias on macOS. No user-controlled descendant symlink is
  // followed; all components below this fixed system alias are checked below.
  if(file.startsWith('/etc/'))return path.join(fs.realpathSync('/etc'),file.slice(5));
  return file;
}
function metadata(file,{marker=false}={}) {
  let cursor=path.parse(file).root;
  for(const part of file.slice(cursor.length).split(path.sep).slice(0,-1)) {
    cursor=path.join(cursor,part);
    try{if(!fs.lstatSync(cursor).isDirectory())fail();}catch(error){if(error.code==='ENOENT')return {kind:'absent'};throw error;}
  }
  let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {kind:'absent'};throw error;}
  if(marker&&stat.isDirectory())return {kind:'directory',dev:stat.dev,ino:stat.ino,mode:stat.mode&0o777};
  if(!stat.isFile()||stat.nlink!==1)fail();
  const read=boundedRead(file),after=fs.lstatSync(file);
  if(stat.dev!==after.dev||stat.ino!==after.ino||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs||stat.size!==after.size||after.nlink!==1)fail();
  return {kind:'file',dev:stat.dev,ino:stat.ino,mode:read.mode,size:read.bytes.length,sha256:hash(read.bytes)};
}
export function captureNativePrerequisiteContext({homeDir,cwd,inventory,systemFiles}) {
  if(!absolute(homeDir)||!absolute(cwd)||fs.realpathSync(homeDir)!==homeDir||fs.realpathSync(cwd)!==cwd)fail();
  const roots=[];let cursor=cwd;
  for(let depth=0;depth<64;depth++) {roots.push(cursor);if(path.dirname(cursor)===cursor)break;cursor=path.dirname(cursor);}
  if(roots.at(-1)!==path.parse(cwd).root)fail();
  const files=new Map(),configPaths=new Set();
  const add=(file,options)=>{const normalized=path.normalize(file);files.set(normalized,metadata(normalized,options));};
  for(const root of roots)add(path.join(root,'.git'),{marker:true});
  for(const record of inventory.contextFiles) {
    const locations=record.scope==='global'?[homeDir]:record.ancestors?roots:[cwd];
    for(const location of locations){const file=record.scope==='global'?path.join(homeDir,record.path.slice(2)):path.join(location,record.path);add(file);configPaths.add(file);}
  }
  for(const configured of systemFiles){const file=systemPath(configured);add(file);configPaths.add(file);configPaths.add(configured);}
  const image=[...files].sort(([a],[b])=>a.localeCompare(b));
  return {digest:installationDigest(image),configPaths:[...configPaths],files:image};
}
