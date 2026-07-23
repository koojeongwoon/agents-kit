import json
import os
import re

with open('ast_dump.json', 'r') as f:
    items = json.load(f)

context_vars = ['homeDir', 'projectRoot', 'kitRoot', 'kit', 'permissionsFilePath', 'approvedProjectRoots']
context_funcs = ['globalClientRoots', 'readableRoots', 'isKnownLinkPair', 'resolveMcpConfigForDeploy', 'assertSafeProjectTarget', 'resolveDocumentPath', 'getClientConfigs', 'exists', 'existsBrokenSymlink', 'checkSymlink', 'sendApiError']

git_vars = ['ghLoginSession', 'findGhExecutable', 'findBrewExecutable']
git_funcs = ['execFileResult', 'findExecutable', 'runGit', 'configureGitHubCredentialHelper', 'removeStoredRemoteCredentials', 'openGitHubDevicePage', 'publicGhLoginSession']

config_vars = []
config_funcs = ['getYamlConfigPath', 'readYamlConfig', 'writeYamlConfig']

mcp_vars = ['mergeSmitheryMcp']
skills_vars = ['installSkill', 'skillsCatalog', 'smitheryCatalog', 'fetchSmitheryServer']

imports = []
context_code = []
index_code = []

routes = {
    'status': [], 'files': [], 'deploy': [], 'assets': [], 'mcp': [], 'skills': [], 'projects': [], 'config': [], 'git': []
}

def fix_lib_imports(code, depth):
    if depth == 3:
        return code.replace("'../../lib/", "'../../../lib/").replace('"../../lib/', '"../../../lib/')
    return code

for item in items:
    t = item['type']
    name = item['name']
    code = item['code']
    
    if t == 'ImportDeclaration':
        imports.append(code)
    elif name in context_vars or name in context_funcs:
        context_code.append(code)
    elif name in git_vars or name in git_funcs:
        routes['git'].append(code)
    elif name in config_vars or name in config_funcs:
        routes['config'].append(code)
    elif name in mcp_vars:
        routes['mcp'].append(code)
    elif name in skills_vars:
        routes['skills'].append(code)
    elif t == 'Route':
        route_path = name.split(' ')[1]
        
        target = None
        if route_path.startswith('/api/status') or route_path.startswith('/api/catalog') or route_path.startswith('/api/browse-dirs'):
            target = 'status'
        elif route_path.startswith('/api/file-preview') or route_path.startswith('/api/diff-preview') or route_path.startswith('/api/save-asset-content'):
            target = 'files'
        elif route_path.startswith('/api/deploy-') or route_path.startswith('/api/import-merge') or route_path.startswith('/api/link') or route_path.startswith('/api/unlink'):
            target = 'deploy'
        elif route_path.startswith('/api/kits') or route_path.startswith('/api/create-asset') or route_path.startswith('/api/delete-asset') or route_path.startswith('/api/ai-assist'):
            target = 'assets'
        elif route_path.startswith('/api/mcp/toggle-server') or route_path.startswith('/api/smithery-merge') or (route_path.startswith('/api/smithery-') and route_path != '/api/smithery-recommendations'):
            target = 'mcp'
        elif route_path.startswith('/api/skills-') or route_path.startswith('/api/install-skill') or route_path == '/api/smithery-recommendations':
            target = 'skills'
        elif route_path.startswith('/api/projects'):
            target = 'projects'
        elif route_path.startswith('/api/llm-keys') or route_path.startswith('/api/permissions'):
            target = 'config'
        elif route_path.startswith('/api/git-') or route_path.startswith('/api/gh-'):
            target = 'git'
            
        if target:
            code = re.sub(r'^app\.(get|post|delete|put|patch)\(', r'router.\1(', code)
            routes[target].append(code)
        else:
            index_code.append(code)
    else:
        index_code.append(code)

os.makedirs('routes', exist_ok=True)

with open('context.js', 'w') as f:
    for imp in imports:
        f.write(fix_lib_imports(imp, 2) + '\n')
    f.write('\nexport function createAppContext() {\n')
    for c in context_code:
        indented = '\n'.join('  ' + line if line else line for line in c.split('\n'))
        f.write(indented + '\n\n')
    f.write('  return {\n    homeDir, projectRoot, kitRoot, permissionsFilePath, approvedProjectRoots, globalClientRoots, readableRoots, isKnownLinkPair, resolveMcpConfigForDeploy, assertSafeProjectTarget, resolveDocumentPath, getClientConfigs, exists, existsBrokenSymlink, checkSymlink, sendApiError\n  };\n}\n')

router_imports = [
    "import express from 'express';",
    "import fs from 'fs';",
    "import path from 'path';",
    "import os from 'os';",
    "import crypto from 'crypto';",
    "import { fileURLToPath } from 'url';",
    "import { execFile, spawn } from 'child_process';",
]
lib_imports = []
for imp in imports:
    if "from '../../lib" in imp:
        lib_imports.append(fix_lib_imports(imp, 3))
    
def generate_route_file(name, blocks):
    with open(f'routes/{name}.js', 'w') as f:
        for imp in router_imports:
            f.write(imp + '\n')
        for imp in lib_imports:
            f.write(imp + '\n')
        f.write(f"\nexport function create{name.capitalize()}Router(ctx) {{\n")
        f.write("  const router = express.Router();\n")
        f.write("  const { homeDir, projectRoot, kitRoot, permissionsFilePath, approvedProjectRoots, globalClientRoots, readableRoots, isKnownLinkPair, resolveMcpConfigForDeploy, assertSafeProjectTarget, resolveDocumentPath, getClientConfigs, exists, existsBrokenSymlink, checkSymlink, sendApiError } = ctx;\n\n")
        for block in blocks:
            indented = '\n'.join('  ' + line if line else line for line in block.split('\n'))
            f.write(indented + '\n\n')
        f.write("  return router;\n}\n")

for r_name, r_blocks in routes.items():
    generate_route_file(r_name, r_blocks)

with open('index.js', 'w') as f:
    for imp in imports:
        f.write(fix_lib_imports(imp, 2) + '\n')
    f.write("import { createAppContext } from './context.js';\n")
    for r_name in routes.keys():
        f.write(f"import {{ create{r_name.capitalize()}Router }} from './routes/{r_name}.js';\n")
    f.write('\n')
    
    inserted_routers = False
    for block in index_code:
        if "app.use((err, req, res, next)" in block and not inserted_routers:
            f.write("const ctx = createAppContext();\n")
            for r_name in routes.keys():
                f.write(f"app.use(create{r_name.capitalize()}Router(ctx));\n")
            f.write('\n')
            inserted_routers = True
            
        f.write(block + '\n\n')

