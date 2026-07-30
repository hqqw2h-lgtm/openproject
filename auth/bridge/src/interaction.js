export function assertInteractionUid(expected, actual) {
  if (typeof expected !== 'string' || expected === '' || expected !== actual) {
    throw new Error('OIDC interaction mismatch');
  }
}
