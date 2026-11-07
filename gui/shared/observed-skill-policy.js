// A product boundary, independent of client path adapters and filesystem access.
export function isSharedSkillPath(value) {
  if (typeof value !== 'string') return false;
  const parts=[];
  for (const part of value.replaceAll('\\','/').split('/')) {
    if (!part || part==='.') continue;
    if (part==='..') parts.pop(); else parts.push(part.toLowerCase());
  }
  return parts.some((part,index)=>part==='.agents'&&parts[index+1]==='skills');
}
