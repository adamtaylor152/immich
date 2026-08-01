import supportedVersions from 'src/fork-schema/supported-versions.json';
import { assertExactCertifiedReturnLedger } from 'src/repositories/fork-handoff.repository';

const ledger = ['1000-First', '2000-Second', '3000-Third'];
const residue = supportedVersions.postCertifiedUpstreamMigrations;

describe('assertExactCertifiedReturnLedger', () => {
  it.each([
    ['missing', ['1000-First', '2000-Second']],
    ['extra', [...ledger, '4000-Unknown']],
    ['reordered', ['2000-Second', '1000-First', '3000-Third']],
    ['partial', ['1000-First']],
    ['residue-before-certified', [ledger[0]!, residue[0]!, ledger[1]!, ledger[2]!]],
    ['out-of-order residue suffix', [...ledger, residue[1]!]],
  ])('rejects an %s official return ledger', (_mutation, actual) => {
    expect(() => assertExactCertifiedReturnLedger(actual, ledger)).toThrow(/exact certified v3\.1\.0 ledger/);
  });

  it('accepts only the exact certified ledger', () => {
    expect(assertExactCertifiedReturnLedger(ledger, ledger)).toBe('v3.1.0');
  });

  it.each([
    ['partial', [...ledger, residue[0]!]],
    ['complete', [...ledger, ...residue]],
  ])('accepts a %s re-applied post-certified residue suffix', (_shape, actual) => {
    expect(assertExactCertifiedReturnLedger(actual, ledger)).toBe('v3.1.0');
  });
});
