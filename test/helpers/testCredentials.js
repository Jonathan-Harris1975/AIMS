const FIXTURE_CREDENTIALS = Object.freeze({
  "aims-production": "test-production-suite-key",
  blotato: "test-blotato-key",
  openrouter: "sk-or-test-value",
  "openrouter-anthropic": "sk-or-secret-value",
  "openrouter-global": "sk-or-global-test-value",
  "openrouter-shared": "sk-or-test-shared",
  "openrouter-shared-real": "sk-or-real-shared",
  "zernio-canonical": "canonical-zernio-key",
  "zernio-fallback": "zernio-fallback-key",
  "zernio-generated-art": "zernio-generated-art-key",
});

export function testCredential(label) {
  const value = FIXTURE_CREDENTIALS[label];
  if (!value) throw new Error(`Unknown test credential fixture: ${label}`);
  return value;
}
