import { chunk } from 'lodash-es';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';
import { collectAssetIds } from 'src/commands/migrate/search';
import type { MigrateOptions } from 'src/commands/migrate/types';
import { Queue } from 'src/queue';

/**
 * Phase 8 (best-effort): recreate named people on B and attach their faces.
 *
 * Face data itself cannot be transferred — B re-runs its own detection — so this maps
 * A's names onto faces B found by itself. Two constraints shape the implementation:
 *
 * 1. `PUT /people/:id/reassign` identifies faces by their CURRENT owner: the server looks
 *    them up with `getFacesByIds({ personId, assetId })` and moves the result to `:id`.
 *    So each item's `personId` must be the face's existing person on B, not the target.
 * 2. When an asset has several faces we cannot tell which one was the named person on A
 *    (no embeddings cross the wire). Guessing would put the wrong name on a face, so
 *    ambiguous assets are skipped and counted rather than mislabelled.
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
    try {
      // Reuse an existing same-named person on B so a resumed run never duplicates.
      const existing = await to.searchPerson(person.name);
      let bPersonId = existing.find((e) => e.name === person.name)?.id;
      if (!bPersonId) {
        const created = await to.createPerson({
          name: person.name,
          birthDate: person.birthDate ?? undefined,
          isHidden: person.isHidden,
          isFavorite: person.isFavorite,
          color: person.color ?? undefined,
        });
        bPersonId = created.id;
      }

      const memberAIds = await collectAssetIds(from, { personIds: [person.aId] }, options.includeTrashed);
      const bAssetIds = memberAIds.map((aId) => ledger.bId(aId)).filter((bId): bId is string => !!bId);

      // Resolve each asset's faces on B to find the one to rename.
      const items: Array<{ assetId: string; personId: string }> = [];
      let ambiguous = 0;
      let undetected = 0;
      const resolve = new Queue<string, void>(
        async (bAssetId: string) => {
          const allFaces = await to.getFaces(bAssetId);
          const faces = allFaces.filter((f) => f.person);
          if (faces.length === 0) {
            undetected++; // B hasn't detected a face here (yet)
          } else if (faces.length > 1) {
            ambiguous++; // can't tell which face is this person — skip rather than mislabel
          } else if (faces[0].person!.id !== bPersonId) {
            items.push({ assetId: bAssetId, personId: faces[0].person!.id });
          }
        },
        { concurrency: options.concurrency, retry: 2 },
      );
      for (const bAssetId of bAssetIds) {
        void resolve.push(bAssetId);
      }
      await resolve.drained();

      let attached = 0;
      for (const part of chunk(items, 250)) {
        await to.reassignFaces(bPersonId, part);
        attached += part.length;
      }

      ledger.setPersonDone(person.aId, bPersonId);
      const skipped = [ambiguous > 0 ? `${ambiguous} ambiguous` : '', undetected > 0 ? `${undetected} no face yet` : '']
        .filter(Boolean)
        .join(', ');
      controller.log(`person ${person.name}: ${attached} face(s) attached${skipped ? ` (${skipped})` : ''}`);
    } catch (error) {
      // Leave this person un-done so --retry-failed / a later run can try again once B has
      // finished detecting faces. One bad person must not abort the phase.
      controller.log(`person ${person.name}: failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
