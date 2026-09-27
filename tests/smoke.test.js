const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.host_permissions.includes('https://app.onluyen.vn/*'));
assert.ok(manifest.host_permissions.includes('https://generativelanguage.googleapis.com/*'));
assert.equal(manifest.content_scripts[0].matches[0], 'https://app.onluyen.vn/*');
assert.ok(manifest.permissions.includes('scripting'));
assert.ok(manifest.web_accessible_resources.some(r => r.resources.includes('inject.js')));

const html = read('popup.html');
const popup = read('popup.js');
assert.match(popup, /\^\(\?:AIza\|AQ\\\.\)/, 'Popup must accept both AIza and AQ. Gemini keys');
assert.match(html, /AIza\.\.\. hoặc AQ\.\.\.\./, 'API key inputs must advertise AIza and AQ. support');
const referencedIds = [...popup.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
for (const id of new Set(referencedIds)) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `popup.html thiếu #${id}`);
}

const startHandlerStart = popup.indexOf("$('btnStartBot').addEventListener");
const startHandlerEnd = popup.indexOf("$('btnStopBot').addEventListener", startHandlerStart);
const startHandler = popup.slice(startHandlerStart, startHandlerEnd);
assert.ok(startHandlerStart >= 0 && startHandlerEnd > startHandlerStart, 'Missing Start Bot handler');
assert.ok(
  startHandler.indexOf("action: 'OL_LOAD_DATABASE'") < startHandler.indexOf("action: 'OL_START_BOT'"),
  'Start Bot must load the current JSON before starting'
);

for (const file of ['background.js', 'content.js', 'popup.js', 'inject.js']) {
  const source = read(file);
  assert.doesNotMatch(source, /azota\.vn/i);
}

console.log(`OK: manifest + ${new Set(referencedIds).size} popup IDs + safety checks passed!`);
