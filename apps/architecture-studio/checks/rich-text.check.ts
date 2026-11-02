import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasUnrenderedMarkers, tokenizeInline } from '../src/lib/rich-text.ts';

describe('inline Markdown in repository text', () => {
  it('turns **bold** and `code` into tokens and keeps the rest as written', () => {
    assert.deepEqual(tokenizeInline('1. **The unit of placement is the jurisdiction.** A cell holds `data`.'), [
      { kind: 'text', value: '1. ' },
      { kind: 'bold', value: 'The unit of placement is the jurisdiction.' },
      { kind: 'text', value: ' A cell holds ' },
      { kind: 'code', value: 'data' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('never drops or invents text: the visible characters are the source minus the markers', () => {
    const src = 'a **b** c `d` e ** unmatched and `also';
    const visible = tokenizeInline(src).map((t) => t.value).join('');
    assert.equal(visible, 'a b c d e ** unmatched and `also');
  });

  it('shows an unmatched marker as written instead of guessing', () => {
    assert.deepEqual(tokenizeInline('cost is **high'), [{ kind: 'text', value: 'cost is **high' }]);
    assert.equal(hasUnrenderedMarkers('cost is **high'), true);
    assert.equal(hasUnrenderedMarkers('cost is **high**'), false);
  });

  it('does not treat other Markdown or HTML as markup and never produces HTML', () => {
    const t = tokenizeInline('<script>alert(1)</script> [x](y) # not a heading _x_');
    assert.deepEqual(t, [{ kind: 'text', value: '<script>alert(1)</script> [x](y) # not a heading _x_' }]);
  });

  it('handles empty text and bold at the edges', () => {
    assert.deepEqual(tokenizeInline(''), []);
    assert.deepEqual(tokenizeInline('**all**'), [{ kind: 'bold', value: 'all' }]);
  });
});
