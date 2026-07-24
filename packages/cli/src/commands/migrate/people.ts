import { chunk } from 'lodash-es';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';
import { collectAssetIds } from 'src/commands/migrate/search';
import type { MigrateOptions } from 'src/commands/migrate/types';

/**
 * Phase 8 (best-effort): recreate named people on B and reassign their faces. B re-runs its
 * own face detection, so a reassign only lands if B already detected a face in that asset;
 * misses are expected and left for B to re-cluster. Person creation is idempotent by name.
 */
export async function migratePeople(
  from: ServerClient,
  to: ServerClient,
  ledger: Ledger,
  options: MigrateOptions,
  controller: Controller,
) {
  if (!options.faces) {
    return;
  }
  controller.setPhase('people');
  for (const person of ledger.peopleToDo()) {
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    // Reuse an existing same-named person on B so resume never duplicates.
    const existing = await to.searchPerson(person.name);
    let bPersonId = existing.find((e) => e.name === person.name)?.id;
    if (!bPersonId) {
      const createdPerson = await to.createPerson({
        name: person.name,
        birthDate: person.birthDate ?? undefined,
        isHidden: person.isHidden,
        isFavorite: person.isFavorite,
        color: person.color ?? undefined,
      });
      bPersonId = createdPerson.id;
    }

    const memberAIds = await collectAssetIds(from, { personIds: [person.aId] }, options.includeTrashed);
    const data: Array<{ assetId: string; personId: string }> = [];
    for (const aId of memberAIds) {
      const bId = ledger.bId(aId);
      if (bId) {
        data.push({ assetId: bId, personId: bPersonId });
      }
    }
    for (const part of chunk(data, 500)) {
      try {
        await to.reassignFaces(bPersonId, part);
      } catch {
        // B may not have detected a face in these assets yet; best-effort.
      }
    }
    ledger.setPersonDone(person.aId, bPersonId);
    controller.log(`person: ${person.name}`);
  }
}
