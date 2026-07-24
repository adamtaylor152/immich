# Switching Between the Fork and Official Immich

Immich Enhanced 3.0 and later can switch to a matching, compatibility-certified official Immich release and later return to a compatible fork without deleting dormant fork-owned database state.

Use the [fork-to-official handoff and return runbook](../administration/upstream-handoff.md) for the exact commands, backups, maintenance window, supported image, validation gates, visibility changes, rollback boundary, and return reconciliation procedure.

For databases first opened by older, pre-compatibility fork releases, read [Reverting Back to Official Immich](revert-to-upstream.md) before changing images. Those databases must be converted by a compatibility release or restored from a matched pre-fork backup; they cannot safely use the new handoff commands directly.
