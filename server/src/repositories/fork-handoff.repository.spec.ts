import { assertExactCertifiedReturnLedger } from 'src/repositories/fork-handoff.repository';

const ledger = ['1000-First', '2000-Second', '3000-Third'];

describe('assertExactCertifiedReturnLedger', () => {
  it.each([
    ['missing', ['1000-First', '2000-Second']],
    ['extra', [...ledger, '4000-Unknown']],
    ['reordered', ['2000-Second', '1000-First', '3000-Third']],
    ['partial', ['1000-First']],
  ])('rejects an %s official return ledger', (_mutation, actual) => {
    expect(() => assertExactCertifiedReturnLedger(actual, ledger)).toThrow(/exact certified v3\.0\.3 ledger/);
  });

  it('accepts only the exact certified ledger', () => {
    expect(assertExactCertifiedReturnLedger(ledger, ledger)).toBe('v3.0.3');
  });
});
