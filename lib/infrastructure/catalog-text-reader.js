import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {domainError} from '../domain/errors.js';
import {isWithinRoot,resolveForAuthorization} from '../security-boundary.js';

export function readCatalogText(file,{root,maxBytes=64*1024}) {
  let descriptor,contentRead=false;
  const fail=code=>{throw domainError(code,'Catalog metadata requires an unchanged bounded ordinary file',{contentRead});};
  try {
    const lexicalRoot=path.resolve(root),authorizedRoot=resolveForAuthorization(root),authorized=resolveForAuthorization(file);
    if(!isWithinRoot(path.resolve(file),lexicalRoot)||!isWithinRoot(authorized,authorizedRoot))fail('CATALOG_TEXT_OUTSIDE_SCOPE');
    let cursor=lexicalRoot;const parents=[];
    for(const component of path.relative(lexicalRoot,path.dirname(file)).split(path.sep).filter(Boolean)) {
      cursor=path.join(cursor,component);const stat=fs.lstatSync(cursor);
      if(!stat.isDirectory())fail('CATALOG_TEXT_LINK_UNVERIFIED');parents.push({path:cursor,dev:stat.dev,ino:stat.ino});
    }
    const before=fs.lstatSync(file);if(!before.isFile())fail('CATALOG_TEXT_LINK_UNVERIFIED');if(before.size>maxBytes)fail('CATALOG_TEXT_TOO_LARGE');
    descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const opened=fs.fstatSync(descriptor);
    if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)fail('CATALOG_TEXT_CHANGED');
    const bytes=Buffer.alloc(before.size);contentRead=true;const count=fs.readSync(descriptor,bytes,0,bytes.length,0),after=fs.fstatSync(descriptor),current=fs.lstatSync(file);
    if(count!==before.size||after.mtimeMs!==before.mtimeMs||after.size!==before.size||current.dev!==before.dev||current.ino!==before.ino||!current.isFile()
      ||fs.realpathSync(file)!==authorized||parents.some(parent=>{const stat=fs.lstatSync(parent.path);return !stat.isDirectory()||stat.dev!==parent.dev||stat.ino!==parent.ino;}))fail('CATALOG_TEXT_CHANGED');
    return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  }catch(error){if(error.name==='DomainError')throw error;throw domainError(error.code||'CATALOG_TEXT_INVALID','Catalog metadata could not be read',{contentRead});}
  finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
