'use strict';

const os = require('os');

const async = require('async');
const cheerio = require('cheerio');
const codeFrame = require('@babel/code-frame');
const deepmerge = require('deepmerge');
const linthtml = require('@linthtml/linthtml');
const linthtmlDefault = require('@linthtml/linthtml/lib/presets/default');

const upgradeHtmllintConfig = (htmllint) => {
  const config = {};

  // https://github.com/htmllint/htmllint/blob/5bf468e74207750dc159ce69d5c9507097b89dd8/lib/presets/default.js
  const htmllintDefault = {
    maxerr: false,
    'raw-ignore-regex': false,
    'attr-bans': [
      'align',
      'background',
      'bgcolor',
      'border',
      'frameborder',
      'longdesc',
      'marginwidth',
      'marginheight',
      'scrolling',
      'style',
      'width',
    ],
    'indent-delta': false,
    'indent-style': 'nonmixed',
    'indent-width': 4,
    'indent-width-cont': false,
    'spec-char-escape': true,
    'text-ignore-regex': false,
    'tag-bans': ['b', 'i'],
    'tag-close': true,
    'tag-name-lowercase': true,
    'tag-name-match': true,
    'tag-self-close': false,
    'doctype-first': false,
    'doctype-html5': false,
    'attr-name-style': 'dash',
    'attr-name-ignore-regex': false,
    'attr-no-dup': true,
    'attr-no-unsafe-char': true,
    'attr-order': false,
    'attr-quote-style': 'double',
    'attr-req-value': true,
    'attr-new-line': false,
    'attr-validate': true,
    'id-no-dup': true,
    'id-class-no-ad': true,
    'id-class-style': 'underscore',
    'class-no-dup': true,
    'class-style': false,
    'id-class-ignore-regex': false,
    'img-req-alt': true,
    'img-req-src': true,
    'html-valid-content-model': true,
    'head-valid-content-model': true,
    'href-style': false,
    'link-req-noopener': true,
    'label-req-for': true,
    'line-end-style': 'lf',
    'line-no-trailing-whitespace': true,
    'line-max-len': false,
    'line-max-len-ignore-regex': false,
    'head-req-title': true,
    'title-no-dup': true,
    'title-max-len': 60,
    'html-req-lang': false,
    'lang-style': 'case',
    'fig-req-figcaption': false,
    'focusable-tabindex-style': false,
    'input-radio-req-name': true,
    'input-req-label': false,
    'table-req-caption': false,
    'table-req-header': false,
    'tag-req-attr': false,
    'link-min-length-4': false,
    'input-btn-req-value-or-title': false,
    'button-req-content': false,
    'label-no-enc-textarea-or-select': false,
    'fieldset-contains-legend': false,
  };
  const mergedHtmllint = deepmerge(htmllintDefault, htmllint, {
    arrayMerge: (destinationArray, sourceArray) => sourceArray,
  });

  // https://github.com/linthtml/linthtml/blob/0.3.0/docs/migrations.md
  const rules = Object.keys(mergedHtmllint)
    .reduce((acc, rule) => {
      const ruleConfig = mergedHtmllint[rule];
      if (typeof ruleConfig === 'boolean') {
        acc[rule] = ruleConfig;
      } else {
        acc[rule] = [true, ruleConfig];
      }
      return acc;
    }, {});
  ['maxerr',
    'text-ignore-regex',
    'raw-ignore-regex',
    'attr-name-ignore-regex',
    'id-class-ignore-regex',
    'line-max-len-ignore-regex']
    .forEach((rule) => {
      if (rules[rule] !== undefined) {
        config[rule] = rules[rule];
        delete rules[rule];
      }
    });
  config.rules = rules;

  return config;
};

module.exports = (options) => {
  options = deepmerge(
    {
      linthtml: {
        rules: {
          ...linthtmlDefault,
        },
      },
    },
    {
      html: '**/*.html',
      linthtml: {
        'text-ignore-regex': /&[a-zA-Z0-9]+=/, // https://github.com/htmllint/htmllint/issues/267
        rules: {
          'attr-bans': [
            // https://www.w3.org/TR/html5-diff/#obsolete-attributes
            // https://web.dev/optimize-cls/#images-without-dimensions (Google Lighthouse)
            'align', 'alink', 'background', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'char', 'charoff', 'clear', 'compact', 'frame', 'frameborder', 'hspace', 'link', 'marginheight', 'marginwidth', 'noshade', 'nowrap', 'rules', 'scrolling', 'size', 'text', 'valign', 'vlink', 'vspace',
          ],
          'attr-req-value': false, // https://dev.w3.org/html5/spec-LC/syntax.html#attributes-0
          'doctype-first': true, // https://dev.w3.org/html5/spec-LC/syntax.html#the-doctype
          'id-class-style': false,
          'indent-style': false,
          'indent-width': false,
          'line-end-style': false,
          'line-no-trailing-whitespace': false,
          'tag-bans': [ // https://www.w3.org/TR/html5-diff/#obsolete-elements
            'acronym', 'applet', 'basefont', 'big', 'center', 'dir', 'font', 'frame', 'frameset', 'isindex', 'noframes', 'strike', 'tt',
          ],
          'tag-name-lowercase': false, // https://dev.w3.org/html5/spec-LC/syntax.html#elements-0,
          'title-max-len': false, // https://dev.w3.org/html5/spec-LC/semantics.html#the-title-element
        },
      },
      ignoreTags: [
        // https://github.com/htmllint/htmllint/issues/194
        'code',
        'pre',
        'svg',
        'textarea',
      ],
      parallelism: os.cpus().length,
    },
    options || {},
    { arrayMerge: (destinationArray, sourceArray) => sourceArray },
  );

  return (files, metalsmith, done) => {
    const htmlFiles = metalsmith.match(options.html, Object.keys(files));

    const failures = [];

    async.eachLimit(htmlFiles, options.parallelism, (filename, complete) => {
      const file = files[filename];
      const $ = cheerio.load(file.contents, {
        _useHtmlParser2: true, // https://github.com/cheeriojs/cheerio/issues/1198
        decodeEntities: false,
      });

      // Remove ignored tags
      $(options.ignoreTags.join(', ')).remove();

      const contents = $.html();

      linthtml(contents, options.linthtml || upgradeHtmllintConfig(options.htmllint))
        .then((results) => {
          if (results.length) {
            const codeFrames = results
              .map((result) => {
                // Use @babel/code-frame to get a more human-readable error message
                const frame = codeFrame.codeFrameColumns(contents, {
                  start: result.position.start,
                });
                let data = '';
                if (Object.keys(result.data).length) {
                  data = ` ${JSON.stringify(result.data)}:`;
                }
                return `${result.rule} (${result.code}):${data}\n\n${frame.replace(/^/gm, '  ')}`;
              })
              .join('\n\n');

            failures.push(`${filename}:\n\n${codeFrames.replace(/^/gm, '  ')}`);
          }

          complete();
        });
    }, () => {
      if (failures.length) {
        done(failures.join('\n\n'));
      }

      done();
    });
  };
};
