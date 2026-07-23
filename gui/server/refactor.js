import fs from 'fs';
import parser from '@babel/parser';

const code = fs.readFileSync('index.js', 'utf-8');
const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

const nodes = ast.program.body;
for (const node of nodes) {
  code.substring(node.start, node.end);
  let name = '';
  if (node.type === 'FunctionDeclaration') {
    name = 'Function: ' + node.id.name;
  } else if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.type === 'MemberExpression') {
    const callee = node.expression.callee;
    if (callee.object.name === 'app' && ['get', 'post', 'delete', 'use'].includes(callee.property.name)) {
      if (node.expression.arguments.length > 0 && node.expression.arguments[0].type === 'StringLiteral') {
        name = 'Route: ' + callee.property.name.toUpperCase() + ' ' + node.expression.arguments[0].value;
      } else {
        name = 'Route: app.' + callee.property.name;
      }
    }
  } else if (node.type === 'VariableDeclaration') {
    name = 'Var: ' + node.declarations[0].id.name;
  } else {
    name = node.type;
  }
  console.log(name);
}
