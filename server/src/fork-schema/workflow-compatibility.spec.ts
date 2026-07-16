import {
  ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
  ADD_PLUGIN_TEMPLATES_MIGRATION,
  classifyWorkflowCompatibility,
  LEGACY_WORKFLOW_MIGRATION,
  OFFICIAL_WORKFLOW_MIGRATION,
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

  it('refuses a legacy marker after later official stages', () => {
    expect(() => classifyWorkflowCompatibility(fixture({ legacy: true, later: ['templates'] }))).toThrow(
      'workflow ledger/schema disagreement',
    );
  });
});
