const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { parse } = require('yaml');

const ROOT = join(__dirname, '..');
const OPENAPI_JSON_PATH = join(ROOT, 'schema', 'openapi.json');
const OPENAPI_YAML_PATH = join(ROOT, 'schema', 'openapi.yaml');
const GITIGNORE_PATH = join(ROOT, '.gitignore');

/**
 * Return trimmed non-empty .gitignore lines.
 *
 * @returns {string[]} Ignore patterns.
 */
function gitignoreLines() {
  return readFileSync(GITIGNORE_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

test('schema/openapi.json is present so plugin require succeeds', () => {
  assert.equal(existsSync(OPENAPI_JSON_PATH), true, 'schema/openapi.json is missing');
  const spec = JSON.parse(readFileSync(OPENAPI_JSON_PATH, 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.components.schemas.Entry);
  assert.ok(spec.components.schemas.Log);
});

test('schema/openapi.json is not gitignored so git installs include it', () => {
  const patterns = gitignoreLines();
  assert.equal(patterns.includes('/schema/openapi.json'), false);
  assert.equal(patterns.includes('schema/openapi.json'), false);
  assert.equal(patterns.includes('*.json'), false);
});

test('schema/openapi.json matches schema/openapi.yaml', () => {
  const fromYaml = parse(readFileSync(OPENAPI_YAML_PATH, 'utf8'));
  const fromJson = JSON.parse(readFileSync(OPENAPI_JSON_PATH, 'utf8'));
  assert.deepEqual(fromJson, fromYaml);
});
