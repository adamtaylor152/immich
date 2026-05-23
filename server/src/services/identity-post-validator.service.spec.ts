import { IdentityPostValidator } from 'src/services/identity-post-validator.service';
import type { KnownPerson } from 'src/services/prompt-assembler.service';
import { beforeEach, describe, expect, it } from 'vitest';

const person = (name: string): KnownPerson => ({ name, faceConfidence: 1, boxCenter: [0.5, 0.5] });

describe(IdentityPostValidator.name, () => {
  let sut: IdentityPostValidator;

  beforeEach(() => {
    sut = new IdentityPostValidator();
  });

  describe('hallucinated name stripping', () => {
    it('strips a mid-sentence capitalized word that is not a known person', () => {
      const { description, flags } = sut.validate('A boy and Madison are playing baseball.', []);
      expect(description).toBe('A boy and Someone are playing baseball.');
      expect(flags.hallucinatedNames).toEqual(['Madison']);
    });

    it('does not strip a name that IS a known person', () => {
      const { description, flags } = sut.validate('Conner is playing baseball.', [person('Conner')]);
      expect(description).toBe('Conner is playing baseball.');
      expect(flags.hallucinatedNames).toBeUndefined();
    });

    it('does not strip the first word of a sentence (sentence-start capital)', () => {
      const { description } = sut.validate('The dog runs fast.', []);
      expect(description).toBe('The dog runs fast.');
    });

    it('does not strip a word immediately after sentence-ending punctuation', () => {
      const { description } = sut.validate('A dog runs. Then Madison jumps.', []);
      // "Then" is after "." so it is sentence-start — safe.
      // "Madison" is after "Then " so it is mid-sentence — stripped.
      expect(description).toBe('A dog runs. Then Someone jumps.');
    });

    it('does not strip allow-listed day names', () => {
      const { description } = sut.validate('They met on Monday afternoon.', []);
      expect(description).toBe('They met on Monday afternoon.');
    });

    it('does not strip allow-listed month names', () => {
      const { description } = sut.validate('The photo was taken in December.', []);
      expect(description).toBe('The photo was taken in December.');
    });

    it('does not strip allow-listed holiday names', () => {
      const { description } = sut.validate('They decorated for Christmas.', []);
      expect(description).toBe('They decorated for Christmas.');
    });

    it('does not strip allow-listed geography nouns', () => {
      const { description } = sut.validate('The family visited America last summer.', []);
      expect(description).toBe('The family visited America last summer.');
    });

    it('strips multiple distinct mid-sentence hallucinated names and deduplicates the flag list', () => {
      const { description, flags } = sut.validate('The boys Madison and Zachary are throwing a ball.', []);
      expect(description).toBe('The boys Someone and Someone are throwing a ball.');
      expect(flags.hallucinatedNames).toEqual(expect.arrayContaining(['Madison', 'Zachary']));
      expect(flags.hallucinatedNames).toHaveLength(2);
    });

    it('de-duplicates repeated hallucinated names in the flag list', () => {
      const { flags } = sut.validate('Madison pushed Madison off a swing.', []);
      expect(flags.hallucinatedNames).toEqual(['Madison']);
    });
  });

  describe('generic person substitution — single known person', () => {
    it('substitutes the first generic person reference with the known person name', () => {
      const { description, flags } = sut.validate('A young boy is playing baseball.', [person('Conner')]);
      expect(description).toBe('Conner is playing baseball.');
      expect(flags.ambiguousReferences).toBeUndefined();
    });

    it('substitutes "the woman" with the single known person name', () => {
      const { description } = sut.validate('The woman is sitting on a bench.', [person('Sarah')]);
      expect(description).toBe('Sarah is sitting on a bench.');
    });

    it('substitutes only the first generic reference when multiple are present', () => {
      const { description } = sut.validate('A young boy is playing while a child watches.', [person('Conner')]);
      // Only the first "a young boy" becomes "Conner"; "a child" stays.
      expect(description).toBe('Conner is playing while a child watches.');
    });

    it('leaves description unchanged when it already contains the known name', () => {
      const { description } = sut.validate('Conner is playing baseball.', [person('Conner')]);
      expect(description).toBe('Conner is playing baseball.');
    });
  });

  describe('generic person ambiguity — multiple known persons', () => {
    it('leaves description unchanged and flags ambiguity when multiple known persons', () => {
      const { description, flags } = sut.validate('A young boy is playing baseball.', [
        person('Conner'),
        person('Sarah'),
      ]);
      expect(description).toBe('A young boy is playing baseball.');
      expect(flags.ambiguousReferences).toEqual(['generic-person-with-multiple-known-faces']);
    });

    it('does not flag ambiguity when description already contains a known name', () => {
      const { flags } = sut.validate('Conner is playing baseball.', [person('Conner'), person('Sarah')]);
      expect(flags.ambiguousReferences).toBeUndefined();
    });
  });

  describe('zero known persons — never fabricate names', () => {
    it('does not substitute a generic person reference when knownPersons is empty', () => {
      const { description, flags } = sut.validate('A young boy is playing baseball.', []);
      expect(description).toBe('A young boy is playing baseball.');
      expect(flags.hallucinatedNames).toBeUndefined();
      expect(flags.ambiguousReferences).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('returns an empty flags object when the description has no persons and no candidates', () => {
      const { flags } = sut.validate('A red car is parked on the street.', []);
      expect(flags).toEqual({});
    });

    it('handles empty description gracefully', () => {
      const { description, flags } = sut.validate('', [person('Conner')]);
      expect(description).toBe('');
      expect(flags).toEqual({});
    });

    it('does not substitute when description has no generic person reference even with one known person', () => {
      const { description } = sut.validate('A red ball is on the grass.', [person('Conner')]);
      // No generic person → no substitution.
      expect(description).toBe('A red ball is on the grass.');
    });
  });
});
