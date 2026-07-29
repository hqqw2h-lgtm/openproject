import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml } from '../src/html.js';

test('escapes untrusted values for HTML text and attributes', () => {
  assert.equal(
    escapeHtml('<script data-x="1">alert(\'x\') & more</script>'),
    '&lt;script data-x=&quot;1&quot;&gt;alert(&#39;x&#39;) &amp; more&lt;/script&gt;',
  );
});
