import assert from 'node:assert/strict';
import test from 'node:test';

import { assertInteractionUid } from '../src/interaction.js';

test('accepts only the interaction encoded in the state transaction', () => {
  assert.doesNotThrow(() => assertInteractionUid('interaction-a', 'interaction-a'));
  assert.throws(
    () => assertInteractionUid('interaction-a', 'interaction-b'),
    /OIDC interaction mismatch/,
  );
});
