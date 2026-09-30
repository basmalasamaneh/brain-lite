const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Exercise the actual generated serializer without importing the React runtime.
const source = fs.readFileSync(path.resolve(__dirname, '../../../../lib/api-client-react/src/generated/api.ts'), 'utf8');
function generatedUrl(name, params) {
  const match = source.match(new RegExp(`export const ${name} = \\([^]*?\\) => \\{([^]*?)\\n\\}`));
  assert.ok(match, `${name} must exist in the generated client`);
  return new Function('params', match[1])(params);
}

test('combined keyword/type/date filters preserve YYYY-MM-DD on the wire', () => {
  const url = new URL(generatedUrl('getListMemoriesUrl', {
    search: 'فاتورة Ahmed', type: 'receipt', date_from: '2026-09-29', date_to: '2026-10-01',
  }), 'https://example.test');
  assert.equal(url.pathname, '/api/memories');
  assert.equal(url.searchParams.get('search'), 'فاتورة Ahmed');
  assert.equal(url.searchParams.get('type'), 'receipt');
  assert.equal(url.searchParams.get('date_from'), '2026-09-29');
  assert.equal(url.searchParams.get('date_to'), '2026-10-01');
});

test('related search preserves the same combined date/type filters', () => {
  const url = new URL(generatedUrl('getSearchRelatedUrl', {
    q: 'Ahmed receipt', type: 'receipt', date_from: '2026-09-29', date_to: '2026-10-01',
  }), 'https://example.test');
  assert.equal(url.pathname, '/api/search/related');
  assert.equal(url.searchParams.get('q'), 'Ahmed receipt');
  assert.equal(url.searchParams.get('type'), 'receipt');
  assert.equal(url.searchParams.get('date_from'), '2026-09-29');
  assert.equal(url.searchParams.get('date_to'), '2026-10-01');
});

test('empty optional dates are omitted rather than converted to Date or null', () => {
  const url = new URL(generatedUrl('getListMemoriesUrl', { search: 'test' }), 'https://example.test');
  assert.equal(url.searchParams.has('date_from'), false);
  assert.equal(url.searchParams.has('date_to'), false);
});