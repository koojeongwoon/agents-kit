import fs from 'fs';
import parser from '@babel/parser';

const code = fs.readFileSync('index.js', 'utf-8');
const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

const items = [];
ast.program.body.forEach((node) => {
  let start = node.start;
  if (node.leadingComments) {
    start = node.leadingComments[0].start;
  }
  let snippet = code.substring(start, node.end);
  
  let name = '';
  let type = node.type;
  
  if (node.type === 'FunctionDeclaration') {
    name = node.id.name;
    type = 'Func';
  } else if (node.type === 'VariableDeclaration') {
    name = node.declarations[0].id.name;
    type = 'Var';
  } else if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.type === 'MemberExpression') {
    const callee = node.expression.callee;
    if (callee.object.name === 'app' && ['get', 'post', 'delete', 'use'].includes(callee.property.name)) {
      if (node.expression.arguments.length > 0 && node.expression.arguments[0].type === 'StringLiteral') {
        name = callee.property.name.toUpperCase() + ' ' + node.expression.arguments[0].value;
        type = 'Route';
      } else {
        name = 'app.' + callee.property.name;
        type = 'AppCall';
      }
    }
  }

  items.push({ type, name, code: snippet });
});

fs.writeFileSync('ast_dump.json', JSON.stringify(items, null, 2));
console.log('Dumped to ast_dump.json');
