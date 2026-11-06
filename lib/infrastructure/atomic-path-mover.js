import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {domainError} from '../domain/errors.js';

// Fixed trusted adapter code, isolated from PYTHONPATH/site hooks. Paths are argv,
// never interpolated into code or passed to a shell. No source/package code runs.
const BRIDGE = `import ctypes,errno,json,os,sys
lib=ctypes.CDLL(None,use_errno=True)
darwin=sys.platform=='darwin'
fn=getattr(lib,'renameatx_np' if darwin else 'renameat2',None)
if fn is None or sys.platform not in ('darwin','linux'):
 print(json.dumps({'error':'UNSUPPORTED'}));sys.exit(0)
if sys.argv[1]=='probe':
 print(json.dumps({'supported':True}));sys.exit(0)
fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
fn.restype=ctypes.c_int
flag=(4 if darwin else 1) if sys.argv[1]=='exclusive' else 2
def parent(value):
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 try:
  for name in os.path.dirname(value).split('/'):
   if not name: continue
   child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
   os.close(fd);fd=child
  return fd
 except:
  os.close(fd);raise
try:
 src=parent(sys.argv[2]);dst=parent(sys.argv[3])
 result=fn(src,os.fsencode(os.path.basename(sys.argv[2])),dst,os.fsencode(os.path.basename(sys.argv[3])),flag)
except OSError as e:
 print(json.dumps({'error':errno.errorcode.get(e.errno,'UNKNOWN')}));sys.exit(0)
print(json.dumps({'ok':True} if result==0 else {'error':errno.errorcode.get(ctypes.get_errno(),'UNKNOWN')}))
`;
export class AtomicPathMover {
  constructor({python = 'python3'} = {}) {this.python = python;}
  run(action, source = '', target = '') {
    if (action !== 'probe' && [source, target].some(value => !path.isAbsolute(value) || value === '/' || /[\u0000-\u001f\u007f]/.test(value))) {
      throw domainError('ATOMIC_PATH_UNSAFE', 'Atomic operations require absolute reviewed paths');
    }
    let result;
    try {result = JSON.parse(execFileSync(this.python, ['-I', '-S', '-c', BRIDGE, action, source, target],
      {encoding: 'utf8', timeout: 10000, maxBuffer: 4096, env: {PATH: process.env.PATH || '/usr/bin:/bin'}, stdio: ['ignore', 'pipe', 'pipe']}));}
    catch {throw domainError('ATOMIC_PATH_UNAVAILABLE', 'Atomic directory operations require the supported isolated filesystem helper');}
    if (result.supported || result.ok) return true;
    if (['EEXIST', 'ENOTEMPTY'].includes(result.error)) throw domainError('ATOMIC_PATH_COLLISION', 'The destination already exists and was preserved');
    if (['UNSUPPORTED', 'ENOSYS', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(result.error)) throw domainError('ATOMIC_PATH_UNSUPPORTED', 'This filesystem cannot provide the required atomic operation');
    throw domainError('ATOMIC_PATH_FAILED', 'The atomic path operation failed without a copy/delete fallback', {reason: result.error});
  }
  probe() {return this.run('probe');}
  moveExclusive(source, target) {return this.run('exclusive', source, target);}
  exchange(source, target) {return this.run('exchange', source, target);}
}
