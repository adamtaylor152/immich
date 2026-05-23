import type { KnownPerson } from 'src/services/prompt-assembler.service';

export interface IdentityValidationResult {
  description: string;
  flags: {
    hallucinatedNames?: string[];
    ambiguousReferences?: string[];
  };
}

/**
 * Capitalized words that appear mid-sentence but are not person names.
 * This list is intentionally small — only words that would plausibly
 * trigger the candidate-name heuristic (CapitalizedWord mid-sentence).
 *
 * Note: some entries (e.g. April, May) are also common given names. They are
 * safe here because `knownPersons` names are checked first and are never
 * stripped regardless of allow-list membership — so a person literally named
 * "May" will still survive the validator.
 */
const COMMON_NON_NAME_WORDS = new Set([
  // Days of the week
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  // Months
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  // Common holiday / seasonal nouns that appear mid-sentence capitalized
  'Christmas',
  'Easter',
  'Halloween',
  'Thanksgiving',
  'Hanukkah',
  'Diwali',
  'Ramadan',
  'Eid',
  // Geographic nouns that appear standalone (continents, well-known places)
  'America',
  'Europe',
  'Asia',
  'Africa',
  'Australia',
  'Antarctica',
  'Arctic',
  // Titles / honorifics that could precede names but aren't names themselves
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'Prof',
  // Common pronouns / words that get sentence-internally capitalised in some styles
  'God',
  'Earth',
  'Sun',
  'Moon',
  'Internet',
]);

/**
 * Regex that matches a generic person reference (article + optional modifier +
 * person noun). Only the first match is substituted.
 * NOTE: Do NOT use this as a module-level constant with the `g` flag — the
 * `g` flag makes RegExp#exec stateful (it tracks lastIndex). Always create a
 * fresh instance per call with `new RegExp(...)` or use a non-`g` version.
 */
const GENERIC_PERSON_PATTERN =
  /\b(?:a|an|the) (?:young |older |old |little |small |tall |short |elderly )?(?:boy|girl|man|woman|child|teenager|baby|kid|guy|gal|person|adult|senior)\b/i;

/**
 * Returns true if the character before `index` in `text` (ignoring whitespace)
 * is a sentence-ending punctuation mark, or if `index` is 0 (start of string).
 */
const isAfterSentenceEnd = (text: string, index: number): boolean => {
  if (index === 0) {
    return true;
  }
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      continue;
    }
    return ch === '.' || ch === '!' || ch === '?' || ch === ':';
  }
  return true; // reached start
};

export class IdentityPostValidator {
  /**
   * Post-process an ML-generated description against the set of known persons
   * detected in the image.
   *
   * - Strips hallucinated names (capitalized mid-sentence tokens not in
   *   `knownPersons`) and replaces them with "Someone".
   * - When exactly one known person is present and the description has no
   *   known name but does have a generic person reference, substitutes the
   *   person's name for the first generic reference.
   * - When multiple known persons are present in the same generic-reference
   *   scenario, flags the ambiguity without modifying the text.
   */
  validate(description: string, knownPersons: KnownPerson[]): IdentityValidationResult {
    const flags: IdentityValidationResult['flags'] = {};
    const knownNames = new Set(knownPersons.map((p) => p.name));

    // ---- Step 1: strip hallucinated names ----
    // Candidate pattern: a CamelCase word (single capital + lowercase letters)
    // that appears mid-sentence (not at sentence start, not in allow-list).
    const candidateRe = /\b([A-Z][a-z]+)\b/g;
    const hallucinatedNames: string[] = [];
    let stripped = description.replaceAll(candidateRe, (match, word, offset) => {
      // Sentence-start capitals are legitimate — don't strip them.
      if (isAfterSentenceEnd(description, offset)) {
        return match;
      }
      // Allow-listed common non-name words.
      if (COMMON_NON_NAME_WORDS.has(word)) {
        return match;
      }
      // Known persons are fine.
      if (knownNames.has(word)) {
        return match;
      }
      // Anything else that looks like a name mid-sentence is hallucinated.
      hallucinatedNames.push(word);
      return 'Someone';
    });

    if (hallucinatedNames.length > 0) {
      flags.hallucinatedNames = [...new Set(hallucinatedNames)];
    }

    // ---- Step 2: check whether any known name now appears in the description ----
    const descriptionContainsKnownName = knownPersons.some((p) => stripped.includes(p.name));

    // ---- Step 3: substitute / flag generic references ----
    if (!descriptionContainsKnownName && knownPersons.length > 0) {
      const genericMatch = GENERIC_PERSON_PATTERN.exec(stripped);
      if (genericMatch) {
        if (knownPersons.length === 1) {
          // Unambiguous: substitute first generic reference with the known name.
          stripped =
            stripped.slice(0, genericMatch.index) +
            knownPersons[0].name +
            stripped.slice(genericMatch.index + genericMatch[0].length);
        } else {
          // Multiple known persons — can't tell which one the generic refers to.
          flags.ambiguousReferences = ['generic-person-with-multiple-known-faces'];
        }
      }
    }

    return { description: stripped, flags };
  }
}
