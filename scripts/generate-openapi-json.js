#!/usr/bin/env node

const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { parse } = require('yaml');

/** Project root directory (parent of `scripts/`). */
const PROJECT_ROOT = join(__dirname, '..');

/** Source OpenAPI document checked into git. */
const OPENAPI_YAML_PATH = join(PROJECT_ROOT, 'schema', 'openapi.yaml');

/** JSON copy required at plugin startup by `plugin/Log.js`. */
const OPENAPI_JSON_PATH = join(PROJECT_ROOT, 'schema', 'openapi.json');

/**
 * Convert `schema/openapi.yaml` into `schema/openapi.json`.
 *
 * Uses the runtime `yaml` dependency so git/GitHub installs can generate the
 * JSON during `prepare` even when devDependencies (including `js-yaml`) are
 * omitted.
 *
 * @returns {void}
 */
function generateOpenApiJson() {
  const yamlSource = readFileSync(OPENAPI_YAML_PATH, 'utf8');
  const document = parse(yamlSource);
  writeFileSync(OPENAPI_JSON_PATH, `${JSON.stringify(document, null, 2)}\n`);
}

generateOpenApiJson();
