import supportedVersions from 'src/fork-schema/supported-versions.json';
import {
  ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
  ADD_PLUGIN_TEMPLATES_MIGRATION,
  classifyWorkflowCompatibility,
  LEGACY_WORKFLOW_MIGRATION,
  normalizeWorkflowMigrationForOfficialOrder,
  OFFICIAL_WORKFLOW_MIGRATION,
  validateOfficialMigrationLedgerOrder,
  WORKFLOW_SCHEMA_DIGESTS,
  WorkflowCompatibilityEvidence,
} from 'src/fork-schema/workflow-compatibility';

const timestamp = '2026-07-15T00:00:00.000Z';

const fixture = ({
  later = [],
  legacy = false,
  official = false,
  schema = 'post-update',
}: {
  later?: Array<'allowed-hosts' | 'templates' | 'templates-without-ledger'>;
  legacy?: boolean;
  official?: boolean;
  schema?: 'mismatch' | keyof typeof WORKFLOW_SCHEMA_DIGESTS;
}): WorkflowCompatibilityEvidence => {
  const ledger = [
    ...(official ? [{ name: OFFICIAL_WORKFLOW_MIGRATION, timestamp }] : []),
    ...(legacy ? [{ name: LEGACY_WORKFLOW_MIGRATION, timestamp }] : []),
    ...(later.includes('templates') ? [{ name: ADD_PLUGIN_TEMPLATES_MIGRATION, timestamp }] : []),
    ...(later.includes('allowed-hosts')
      ? [
          { name: ADD_PLUGIN_TEMPLATES_MIGRATION, timestamp },
          { name: ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION, timestamp },
        ]
      : []),
  ];
  const schemaStage = later.includes('templates-without-ledger')
    ? 'post-plugin-templates'
    : later.includes('allowed-hosts')
      ? 'post-allowed-hosts'
      : later.includes('templates')
        ? 'post-plugin-templates'
        : schema === 'mismatch'
          ? 'post-update'
          : schema;
  return {
    ledger,
    rowDigests: [{ count: 1, digest: 'rows', table: 'public.plugin' }],
    schemaDigest: schema === 'mismatch' ? 'mismatch' : WORKFLOW_SCHEMA_DIGESTS[schemaStage],
    schemaStage,
  };
};

describe(classifyWorkflowCompatibility, () => {
  it.each([
    { official: true, legacy: true, error: 'both workflow migration markers' },
    { official: false, legacy: false, error: 'no workflow migration marker' },
    { official: false, legacy: true, schema: 'mismatch' as const, error: 'workflow schema fingerprint' },
    {
      official: true,
      legacy: false,
      later: ['templates-without-ledger' as const],
      error: 'workflow ledger/schema disagreement',
    },
  ])('fails closed for $error', ({ official, legacy, schema = 'post-update', later = [], error }) => {
    expect(() =>
      classifyWorkflowCompatibility(
        fixture({ official, legacy, schema: schema as 'mismatch' | keyof typeof WORKFLOW_SCHEMA_DIGESTS, later }),
      ),
    ).toThrow(error);
  });

  it('classifies original Immich without requesting an alias', () => {
    expect(classifyWorkflowCompatibility(fixture({ official: true, legacy: false }))).toMatchObject({
      mode: 'official',
    });
  });

  it('classifies the SQL-equivalent fork marker as an alias', () => {
    expect(classifyWorkflowCompatibility(fixture({ official: false, legacy: true }))).toMatchObject({
      mode: 'legacy-alias',
      timestamp,
    });
  });

  it.each([
    ['post-plugin-templates', ['templates'] as const],
    ['post-allowed-hosts', ['allowed-hosts'] as const],
  ])('accepts official ledger and schema agreement at %s', (schemaStage, later) => {
    expect(classifyWorkflowCompatibility(fixture({ official: true, later: [...later] }))).toMatchObject({
      mode: 'official',
      schemaDigest: WORKFLOW_SCHEMA_DIGESTS[schemaStage as keyof typeof WORKFLOW_SCHEMA_DIGESTS],
    });
  });

  it.each([
    ['post-plugin-templates', ['templates'] as const],
    ['post-allowed-hosts', ['allowed-hosts'] as const],
  ])('accepts a legacy alias with matching later official ledger and schema at %s', (schemaStage, later) => {
    expect(classifyWorkflowCompatibility(fixture({ legacy: true, later: [...later] }))).toMatchObject({
      mode: 'legacy-alias',
      schemaDigest: WORKFLOW_SCHEMA_DIGESTS[schemaStage as keyof typeof WORKFLOW_SCHEMA_DIGESTS],
    });
  });
});

describe(validateOfficialMigrationLedgerOrder, () => {
  const expected = supportedVersions.upstreamMigrations;
  const providerWithoutAuditedGaps = (prefix: string[]) =>
    prefix.filter(
      (name) =>
        name !== OFFICIAL_WORKFLOW_MIGRATION &&
        name !== ADD_PLUGIN_TEMPLATES_MIGRATION &&
        name !== ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
    );

  it.each([OFFICIAL_WORKFLOW_MIGRATION, ADD_PLUGIN_TEMPLATES_MIGRATION, ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION])(
    'accepts an exact timestamp-ordered prefix spanning the audited provider gap %s',
    (gap) => {
      const prefix = expected.slice(0, expected.indexOf(gap) + 1);
      expect(validateOfficialMigrationLedgerOrder(prefix, providerWithoutAuditedGaps(prefix))).toMatchObject({
        valid: true,
      });
    },
  );

  it('rejects a special marker when its official predecessors are missing', () => {
    expect(validateOfficialMigrationLedgerOrder([OFFICIAL_WORKFLOW_MIGRATION], [])).toMatchObject({ valid: false });
  });

  it('rejects special markers whose ledger timestamps put them in reversed order', () => {
    const predecessorIndex = expected.indexOf(OFFICIAL_WORKFLOW_MIGRATION);
    const prefix = expected.slice(0, predecessorIndex);
    const ledger = [...prefix, ADD_PLUGIN_TEMPLATES_MIGRATION, OFFICIAL_WORKFLOW_MIGRATION];
    expect(validateOfficialMigrationLedgerOrder(ledger, providerWithoutAuditedGaps(ledger))).toMatchObject({
      valid: false,
    });
  });
});

describe(normalizeWorkflowMigrationForOfficialOrder, () => {
  it('substitutes only the certified SQL-equivalent legacy marker', () => {
    expect(normalizeWorkflowMigrationForOfficialOrder(LEGACY_WORKFLOW_MIGRATION)).toBe(OFFICIAL_WORKFLOW_MIGRATION);
    expect(normalizeWorkflowMigrationForOfficialOrder(ADD_PLUGIN_TEMPLATES_MIGRATION)).toBe(
      ADD_PLUGIN_TEMPLATES_MIGRATION,
    );
  });
});
