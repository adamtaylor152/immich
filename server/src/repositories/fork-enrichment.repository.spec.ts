import { Kysely } from 'kysely';
import { canonicalize, digest, ForkEnrichmentRepository } from 'src/repositories/fork-enrichment.repository';
import { DB } from 'src/schema';

type Boundary = { start: number; end: number };
const sut = new ForkEnrichmentRepository(undefined as unknown as Kysely<DB>) as unknown as {
  generatedFields(provenance: Record<string, any>): { description: string | null; tags: string[] };
  findExactParagraphs(value: string, block: string): Boundary[];
  removeExactParagraph(value: string, match: Boundary): string;
};

describe('fork-enrichment canonicalization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const canonical = canonicalize({ b: { d: 1, c: [{ z: 1, a: 2 }, 'x'] }, a: true });

    expect(JSON.stringify(canonical)).toBe('{"a":true,"b":{"c":[{"a":2,"z":1},"x"],"d":1}}');
  });

  it('passes primitives and null through unchanged', () => {
    expect(canonicalize(null)).toBeNull();
    expect(canonicalize('text')).toBe('text');
    expect(canonicalize(5)).toBe(5);
  });

  it('produces the same digest regardless of key order', () => {
    expect(digest([{ a: 1, b: { c: 2, d: 3 } }])).toBe(digest([{ b: { d: 3, c: 2 }, a: 1 }]));
  });

  it('changes the digest when a value changes', () => {
    expect(digest([{ a: 1 }])).not.toBe(digest([{ a: 2 }]));
    expect(digest([])).not.toBe(digest([{}]));
  });

  it('is stable for the empty batch', () => {
    expect(digest([])).toBe(digest([]));
  });
});

describe('generatedFields', () => {
  it('returns nothing without a description task', () => {
    expect(sut.generatedFields({})).toEqual({ description: null, tags: [] });
  });

  it('returns nothing for an unsuccessful description task', () => {
    expect(sut.generatedFields({ description: { status: 'failed', result: { description: 'x' } } })).toEqual({
      description: null,
      tags: [],
    });
  });

  it('extracts the generated description and applied tags on success', () => {
    expect(
      sut.generatedFields({
        description: { status: 'success', result: { description: 'scene', tags: ['b'] }, appliedTagValues: ['a'] },
      }),
    ).toEqual({ description: 'scene', tags: ['a'] });
  });

  it('falls back to result tags when no applied tags are recorded', () => {
    expect(sut.generatedFields({ description: { status: 'success', result: { tags: ['b'] } } })).toEqual({
      description: null,
      tags: ['b'],
    });
  });

  it('ignores a non-string generated description', () => {
    expect(sut.generatedFields({ description: { status: 'success', result: { description: 5 } } })).toEqual({
      description: null,
      tags: [],
    });
  });
});

describe('findExactParagraphs', () => {
  const block = 'AI description: scene';

  it('matches the whole value', () => {
    expect(sut.findExactParagraphs(block, block)).toEqual([{ start: 0, end: block.length }]);
  });

  it('matches paragraphs bounded by blank lines at the start, middle, and end', () => {
    const value = `${block}\n\nmiddle\n\n${block}\n\nuser\n\n${block}`;

    expect(sut.findExactParagraphs(value, block)).toEqual([
      { start: 0, end: block.length },
      { start: block.length + 10, end: block.length * 2 + 10 },
      { start: value.length - block.length, end: value.length },
    ]);
  });

  it('rejects occurrences that are not on paragraph boundaries', () => {
    expect(sut.findExactParagraphs(`prefix ${block}`, block)).toEqual([]);
    expect(sut.findExactParagraphs(`${block} suffix`, block)).toEqual([]);
    expect(sut.findExactParagraphs(`${block}\nsingle newline`, block)).toEqual([]);
  });
});

describe('removeExactParagraph', () => {
  it('removes a middle paragraph along with its separator', () => {
    expect(sut.removeExactParagraph('a\n\nB\n\nc', { start: 3, end: 4 })).toBe('a\n\nc');
  });

  it('removes a leading paragraph and the following separator', () => {
    expect(sut.removeExactParagraph('B\n\nc', { start: 0, end: 1 })).toBe('c');
  });

  it('removes a paragraph that spans the whole value', () => {
    expect(sut.removeExactParagraph('B', { start: 0, end: 1 })).toBe('');
  });
});
