const DIRECTIVE = /^\s*(oxlint-|eslint-|@ts-expect-error|\/\s*<reference\s)/;

export default {
  meta: { name: 'ars' },
  rules: {
    'no-comments': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Disallow code comments; name things so the code explains itself.' },
        messages: { noComment: 'Code comments are not allowed. Express the intent in names or types instead.' },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (!DIRECTIVE.test(comment.value)) context.report({ loc: comment.loc, messageId: 'noComment' });
            }
          },
        };
      },
    },
  },
};
