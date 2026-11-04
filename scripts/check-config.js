'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

// This validates public local metadata only. It does not test any service connection.
function checkConfig(config) {
  const input = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const missing = [];
  const envId = typeof input.envId === 'string' ? input.envId.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{2,63}$/.test(envId) || /^(replace|your|example|placeholder)(-|$)/i.test(envId)) {
    missing.push('envId');
  }
  if (typeof input.appId !== 'string' || !/^wx[0-9a-fA-F]{16}$/.test(input.appId.trim())) {
    missing.push('appId');
  }
  return { ready: missing.length === 0, missing };
}

if (require.main === module) {
  let result;
  try {
    const filename = process.argv[2] || path.join(__dirname, '../deployment/config.example.json');
    result = checkConfig(JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')));
  } catch {
    // Do not expose parser excerpts, file contents, or provider error messages.
    result = { ready: false, missing: ['configFile'] };
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ready ? 0 : 1;
}

module.exports = { checkConfig };
