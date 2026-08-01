import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonical, digest, loadState, saveState } from './fork-schema-certification';

const lane = `fork-schema-certification-${process.pid}`;
const stateDir = process.env.FORK_ROUNDTRIP_STATE_DIR ?? '/tmp/immich-fork-roundtrip';

describe('fork schema certification evidence', () => {
  afterEach(async () => {
    await rm(join(stateDir, `${lane}.json`), { force: true });
  });

  it('preserves non-finite numbers as explicit sentinels through a JSON state roundtrip', async () => {
    expect(
      canonical([
        {
          nested: [{ negativeInfinity: -Infinity }],
          nullValue: null,
          score: NaN,
        },
      ]),
    ).toEqual([
      {
        nested: [{ negativeInfinity: '[non-finite:-Infinity]' }],
        nullValue: null,
        score: '[non-finite:NaN]',
      },
    ]);

    await saveState(lane, {
      finite: 0.91,
      nested: [{ nan: NaN, negativeInfinity: -Infinity }],
      nullValue: null,
      positiveInfinity: Infinity,
    });

    await expect(loadState(lane)).resolves.toEqual({
      finite: 0.91,
      nested: [{ nan: '[non-finite:NaN]', negativeInfinity: '[non-finite:-Infinity]' }],
      nullValue: null,
      positiveInfinity: '[non-finite:Infinity]',
    });
    expect(digest({ score: NaN })).not.toBe(digest({ score: null }));
  });
});
