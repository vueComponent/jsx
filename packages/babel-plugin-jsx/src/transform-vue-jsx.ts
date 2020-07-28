import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import { addNamespace } from '@babel/helper-module-imports';
import {
  createIdentifier,
  transformJSXSpreadChild,
  transformJSXText,
  transformJSXExpressionContainer,
  walksScope,
  buildIIFE,
} from './utils';
import buildProps from './buildProps';
import SlotFlags from './slotFlags';
import { State } from '.';

/**
 * Get children from Array of JSX children
 * @param paths Array<JSXText | JSXExpressionContainer  | JSXElement | JSXFragment>
 * @returns Array<Expression | SpreadElement>
 */
const getChildren = (
  paths: NodePath<
    t.JSXText
      | t.JSXExpressionContainer
      | t.JSXSpreadChild
      | t.JSXElement
      | t.JSXFragment
    >[],
  state: State,
): t.Expression[] => paths
  .map((path) => {
    if (path.isJSXText()) {
      const transformedText = transformJSXText(path);
      if (transformedText) {
        return t.callExpression(createIdentifier(state, 'createTextVNode'), [transformedText]);
      }
      return transformedText;
    }
    if (path.isJSXExpressionContainer()) {
      const expression = transformJSXExpressionContainer(path);

      if (t.isIdentifier(expression)) {
        const { name } = expression as t.Identifier;
        const { referencePaths = [] } = path.scope.getBinding(name) || {};
        referencePaths.forEach((referencePath) => {
          walksScope(referencePath, name, SlotFlags.DYNAMIC);
        });
      }

      return expression;
    }
    if (t.isJSXSpreadChild(path)) {
      return transformJSXSpreadChild(path as NodePath<t.JSXSpreadChild>);
    }
    if (path.isCallExpression()) {
      return path.node;
    }
    if (path.isJSXElement()) {
      return transformJSXElement(path, state);
    }
    throw new Error(`getChildren: ${path.type} is not supported`);
  }).filter(((value: any) => (
    value !== undefined
      && value !== null
      && !t.isJSXEmptyExpression(value)
  )) as any);

const transformJSXElement = (
  path: NodePath<t.JSXElement>,
  state: State,
): t.CallExpression => {
  const children = getChildren(path.get('children'), state);
  const {
    tag,
    props,
    isComponent,
    directives,
    patchFlag,
    dynamicPropNames,
    slots,
  } = buildProps(path, state);

  const { optimize = false } = state.opts;

  const slotFlag = path.getData('slotFlag') || SlotFlags.STABLE;

  // @ts-ignore
  const createVNode = t.callExpression(createIdentifier(state, 'createVNode'), [
    tag,
    props,
    (children.length || slots) ? (
      isComponent
        ? t.objectExpression([
          !!children.length && t.objectProperty(
            t.identifier('default'),
            t.arrowFunctionExpression([], t.arrayExpression(buildIIFE(path, children))),
          ),
          ...(slots ? (
            t.isObjectExpression(slots)
              ? (slots! as t.ObjectExpression).properties
              : [t.spreadElement(slots!)]
          ) : []),
          optimize && t.objectProperty(
            t.identifier('_'),
            t.numericLiteral(slotFlag),
          ),
        ].filter(Boolean as any))
        : t.arrayExpression(children)
    ) : t.nullLiteral(),
    !!patchFlag && optimize && t.numericLiteral(patchFlag),
    !!dynamicPropNames.size && optimize
    && t.arrayExpression(
      [...dynamicPropNames.keys()].map((name) => t.stringLiteral(name as string)),
    ),
  ].filter(Boolean as any));

  if (!directives.length) {
    return createVNode;
  }

  return t.callExpression(createIdentifier(state, 'withDirectives'), [
    createVNode,
    t.arrayExpression(directives),
  ]);
};

export { transformJSXElement };

export default () => ({
  JSXElement: {
    exit(path: NodePath<t.JSXElement>, state: State) {
      if (!state.get('vue')) {
        state.set('vue', addNamespace(path, 'vue'));
      }
      path.replaceWith(
        transformJSXElement(path, state),
      );
    },
  },
});
