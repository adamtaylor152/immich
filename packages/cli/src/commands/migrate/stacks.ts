import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';

/**
 * Phase 7: recreate stacks (grouped/burst photos) from their translated member IDs, primary
 * first. A stack needs at least two members present on B; smaller ones are marked done.
 */
export async function migrateStacks(to: ServerClient, ledger: Ledger, controller: Controller) {
  controller.setPhase('stacks');
  for (const stack of ledger.stacksToDo()) {
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const orderedAIds = [stack.primaryAId, ...stack.memberAIds.filter((id) => id !== stack.primaryAId)];
    const bAssetIds: string[] = [];
    for (const aId of orderedAIds) {
      const bId = ledger.bId(aId);
      if (bId) {
        bAssetIds.push(bId);
      }
    }
    if (bAssetIds.length < 2) {
      ledger.setStackDone(stack.primaryAId, '');
      continue;
    }
    const created = await to.createStack(bAssetIds);
    ledger.setStackDone(stack.primaryAId, created.id);
  }
}
