import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('    function setActiveCategory('), html.indexOf('    let stopObservingSections'));
const selected = new Map();
const tabs = [1, 2, 3].map(id => ({
  dataset: { cat: String(id) },
  classList: { toggle(_name, active) { selected.set(id, active); } },
  setAttribute(_name, active) { assert.equal(active, String(selected.get(id))); },
}));
const calls = [];
const context = {
  document: { querySelectorAll: () => tabs },
  $: id => id === 'c3' ? { getBoundingClientRect: () => ({ top: 800 }) } : null,
  scrollY: 100,
  alcoholPinned: false,
  window: { scrollTo(options) { calls.push(options); } },
};
vm.createContext(context);
vm.runInContext(source, context);
vm.runInContext('goCategory(3)', context);
assert.equal(calls.length, 1);
assert.equal(calls[0].top, 888);
assert.equal(calls[0].behavior, 'auto', 'category jumps must not animate through other tabs');
assert.equal(selected.get(3), true);
assert.equal(selected.get(1), false);
assert.equal(selected.get(2), false);
vm.runInContext('goCategory(999)', context);
assert.equal(calls.length, 1, 'unknown categories do not scroll');
console.log('PASS: category navigation jumps directly and keeps only the selected tab active.');
