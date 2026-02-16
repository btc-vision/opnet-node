import { AST_NODE_TYPES, ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import type * as ts from 'typescript';

function hasOwnToString(type: ts.Type): boolean {
    const symbol = type.getSymbol();
    if (!symbol) return false;

    const declarations = symbol.getDeclarations();
    if (!declarations) return false;

    for (const decl of declarations) {
        const sourceFile = decl.getSourceFile();
        // Skip Uint8Array's own toString — we only care about user-defined overrides
        if (sourceFile.fileName.includes('lib.es') || sourceFile.fileName.includes('lib.dom')) {
            continue;
        }

        if ('members' in symbol && symbol.members) {
            if (symbol.members.has('toString' as ts.__String)) {
                return true;
            }
        }
    }

    return false;
}

function isUint8ArrayType(type: ts.Type, checker: ts.TypeChecker): boolean {
    const symbol = type.getSymbol();
    if (symbol?.getName() === 'Uint8Array') {
        return true;
    }

    const baseTypes = type.getBaseTypes?.();
    if (baseTypes) {
        for (const baseType of baseTypes) {
            if (isUint8ArrayType(baseType, checker)) {
                return true;
            }
        }
    }

    if (type.isIntersection()) {
        for (const subType of type.types) {
            if (isUint8ArrayType(subType, checker)) {
                return true;
            }
        }
    }

    if (type.isUnion()) {
        return type.types.length > 0 && type.types.every((subType) => isUint8ArrayType(subType, checker));
    }

    const constraint = type.getConstraint?.();
    if (constraint && isUint8ArrayType(constraint, checker)) {
        return true;
    }

    return false;
}

const createRule = ESLintUtils.RuleCreator((name) => `https://github.com/btc-vision/eslint-rules#${name}`);

const rule = createRule({
    name: 'no-uint8array-tostring',
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow .toString() on Uint8Array and branded types (Script, Bytes32, etc.) which produces comma-separated decimals instead of hex'
        },
        messages: {
            noUint8ArrayToString:
                '{{typeName}}.toString() returns comma-separated decimals (e.g. "0,32,70,107"), not a hex string. ' +
                'Use Buffer.from(arr).toString("hex") or toHex() instead.'
        },
        schema: []
    },
    defaultOptions: [],
    create(context) {
        const services = ESLintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();

        return {
            CallExpression(node: TSESTree.CallExpression): void {
                if (
                    node.callee.type !== AST_NODE_TYPES.MemberExpression ||
                    node.callee.property.type !== AST_NODE_TYPES.Identifier ||
                    node.callee.property.name !== 'toString' ||
                    node.arguments.length > 0
                ) {
                    return;
                }

                const objectNode = node.callee.object;
                const tsNode = services.esTreeNodeToTSNodeMap.get(objectNode);
                const type = checker.getTypeAtLocation(tsNode);

                if (isUint8ArrayType(type, checker) && !hasOwnToString(type)) {
                    const typeName = checker.typeToString(type);
                    context.report({
                        node,
                        messageId: 'noUint8ArrayToString',
                        data: { typeName }
                    });
                }
            }
        };
    }
});

const plugin = {
    meta: {
        name: 'eslint-plugin-no-uint8array-tostring',
        version: '1.0.0'
    },
    rules: {
        'no-uint8array-tostring': rule
    }
};

export default plugin;
export { rule };
