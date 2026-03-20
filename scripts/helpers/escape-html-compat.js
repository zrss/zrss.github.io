/* global hexo */
'use strict';

const { escapeHTML } = require('hexo-util');

hexo.extend.helper.register('escape_html', function(str) {
  return escapeHTML(str == null ? '' : String(str));
});
