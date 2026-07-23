import fs from 'fs';
import parser from '@babel/parser';

const code = fs.readFileSync('index.js', 'utf-8');
const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

const groups = {
  imports: [],
  context: [],
  status: [],
  files: [],
  deploy: [],
  assets: [],
  mcp: [],
  skills: [],
  projects: [],
  config: [],
  git: [],
  index: []
};

// Define mapping logic
function assignToGroup(node, snippet) {
  let name = '';
  let isRoute = false;
  let isFunc = false;
  let isVar = false;
  
  if (node.type === 'ImportDeclaration') {
    groups.imports.push(snippet);
    return;
  }
  
  if (node.type === 'FunctionDeclaration') {
    name = node.id.name;
    isFunc = true;
  } else if (node.type === 'VariableDeclaration') {
    name = node.declarations[0].id.name;
    isVar = true;
  } else if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.type === 'MemberExpression') {
    const callee = node.expression.callee;
    if (callee.object.name === 'app' && ['get', 'post', 'delete', 'use'].includes(callee.property.name)) {
      if (node.expression.arguments.length > 0 && node.expression.arguments[0].type === 'StringLiteral') {
        name = callee.property.name.toUpperCase() + ' ' + node.expression.arguments[0].value;
        isRoute = true;
      } else {
        name = 'app.' + callee.property.name;
      }
    }
  }

  // Check where to route it
  const contextFuncs = ['sendApiError', 'globalClientRoots', 'readableRoots', 'isKnownLinkPair', 'resolveMcpConfigForDeploy', 'assertSafeProjectTarget', 'resolveDocumentPath', 'getClientConfigs', 'exists', 'existsBrokenSymlink', 'checkSymlink'];
  const contextVars = ['homeDir', 'projectRoot', 'kitRoot', 'kit', 'permissionsFilePath', 'approvedProjectRoots'];
  const gitFuncs = ['execFileResult', 'findExecutable', 'findGhExecutable', 'findBrewExecutable', 'runGit', 'configureGitHubCredentialHelper', 'removeStoredRemoteCredentials', 'openGitHubDevicePage', 'publicGhLoginSession'];
  const gitVars = ['ghLoginSession'];
  const configFuncs = ['getYamlConfigPath', 'readYamlConfig', 'writeYamlConfig'];
  const mcpVars = ['mergeSmitheryMcp'];
  const skillsVars = ['installSkill', 'skillsCatalog', 'smitheryCatalog', 'fetchSmitheryServer'];
  
  if (isFunc && contextFuncs.includes(name)) { groups.context.push(snippet); return; }
  if (isVar && contextVars.includes(name)) { groups.context.push(snippet); return; }
  if (isFunc && gitFuncs.includes(name)) { groups.git.push(snippet); return; }
  if (isVar && gitVars.includes(name)) { groups.git.push(snippet); return; }
  if (isFunc && configFuncs.includes(name)) { groups.config.push(snippet); return; }
  if (isVar && mcpVars.includes(name)) { groups.mcp.push(snippet); return; }
  if (isVar && skillsVars.includes(name)) { groups.skills.push(snippet); return; }

  if (isRoute) {
    const route = name.split(' ')[1];
    snippet = snippet.replace(/^app\.(get|post|delete|put|patch)\(/, 'router.$1(');
    
    if (route.startsWith('/api/status') || route.startsWith('/api/catalog') || route.startsWith('/api/browse-dirs')) { groups.status.push(snippet); return; }
    if (route.startsWith('/api/file-preview') || route.startsWith('/api/diff-preview') || route.startsWith('/api/save-asset-content')) { groups.files.push(snippet); return; }
    if (route.startsWith('/api/deploy-global-all') || route.startsWith('/api/deploy-project') || route.startsWith('/api/deploy-client') || route.startsWith('/api/deploy-single-asset') || route.startsWith('/api/import-merge') || route.startsWith('/api/link') || route.startsWith('/api/unlink')) { groups.deploy.push(snippet); return; }
    if (route.startsWith('/api/kits') || route.startsWith('/api/create-asset') || route.startsWith('/api/delete-asset') || route.startsWith('/api/ai-assist')) { groups.assets.push(snippet); return; }
    if (route.startsWith('/api/mcp/toggle-server') || route.startsWith('/api/smithery-') && route !== '/api/smithery-recommendations') {
       if (route === '/api/smithery-merge') { groups.mcp.push(snippet); return; }
       if (route.startsWith('/api/smithery-')) { groups.mcp.push(snippet); return; } // wait, smithery-recommendations is in skills? prompt says: smithery-* in mcp, BUT fetchSmitheryServer is in skills? Let's put all smithery-* in mcp
       groups.mcp.push(snippet); return; 
    }
    if (route.startsWith('/api/skills-recommendations') || route.startsWith('/api/skills-search') || route.startsWith('/api/install-skill')) { groups.skills.push(snippet); return; }
    if (route.startsWith('/api/projects')) { groups.projects.push(snippet); return; }
    if (route.startsWith('/api/llm-keys') || route.startsWith('/api/permissions')) { groups.config.push(snippet); return; }
    if (route.startsWith('/api/git-') || route.startsWith('/api/gh-')) { groups.git.push(snippet); return; }
  }

  // Default to index
  groups.index.push(snippet);
}

// Ensure comments that are outside nodes are preserved. We'll just attach leading comments that belong to the node.
ast.program.body.forEach((node) => {
  let start = node.start;
  if (node.leadingComments) {
    start = node.leadingComments[0].start;
  }
  let snippet = code.substring(start, node.end);
  assignToGroup(node, snippet);
});

console.log('Parsing complete.');

