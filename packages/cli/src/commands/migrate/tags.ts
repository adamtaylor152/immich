import { chunk } from 'lodash-es';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';
import { collectAssetIds } from 'src/commands/migrate/search';
import type { MigrateOptions } from 'src/commands/migrate/types';

/**
 * Phase 5: recreate the tag hierarchy on B and assign each asset its DIRECT tags. The
 * server's tagIds filter is hierarchical (matches descendants too), so direct membership
 * is derived by subtraction: direct(T) = assets(T) \ union(assets(direct children of T)).
 */
export async function migrateTags(
  from: ServerClient,
  to: ServerClient,
  ledger: Ledger,
  options: MigrateOptions,
  controller: Controller,
) {
  controller.setPhase('tags');
  const tags = ledger.allTags();
  if (tags.length === 0) {
    return;
  }

  // 1. Upsert the whole tree by full path (creates intermediate parents), map value -> B id.
  const created = await to.upsertTags(tags.map((t) => t.value));
  const valueToBId = new Map(created.map((t) => [t.value, t.id]));
  for (const tag of tags) {
    const bId = valueToBId.get(tag.value);
    if (bId) {
      ledger.setTagBId(tag.aId, bId);
    }
  }

  const directChildren = (value: string) =>
    tags.filter((t) => t.value.startsWith(`${value}/`) && !t.value.slice(value.length + 1).includes('/'));

  const hierCache = new Map<string, string[]>();
  const hier = async (tagId: string): Promise<string[]> => {
    let ids = hierCache.get(tagId);
    if (!ids) {
      ids = await collectAssetIds(from, { tagIds: [tagId] }, options.includeTrashed);
      hierCache.set(tagId, ids);
    }
    return ids;
  };

  // 2. Assign direct membership per tag.
  for (const tag of tags) {
    if (tag.assigned) {
      continue;
    }
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const bTagId = valueToBId.get(tag.value);
    if (!bTagId) {
      continue;
    }
    const direct = new Set(await hier(tag.aId));
    for (const child of directChildren(tag.value)) {
      for (const id of await hier(child.aId)) {
        direct.delete(id);
      }
    }
    const bAssetIds: string[] = [];
    for (const aId of direct) {
      const bId = ledger.bId(aId);
      if (bId) {
        bAssetIds.push(bId);
      }
    }
    for (const part of chunk(bAssetIds, 500)) {
      await to.bulkTagAssets([bTagId], part);
    }
    ledger.setTagAssigned(tag.aId);
    controller.log(`tags assigned: ${tag.value}`);
  }
}
