#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/e2e/docker-compose.fork-roundtrip.yml"
STATE_DIR="${FORK_ROUNDTRIP_STATE_DIR:-$ROOT/.cache/fork-roundtrip}"
DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5437/immich'
API_URL='http://127.0.0.1:2287/api'
BACKUP_ID='fork-roundtrip-db-v3.0.3'
SNAPSHOT_ID='fork-roundtrip-media-v3.0.3'

manifest_tag="$(node -e '
  const manifest = require(process.argv[1]);
  if (!Array.isArray(manifest.certifiedTags) || manifest.certifiedTags.length !== 1) process.exit(2);
  process.stdout.write(manifest.certifiedTags[0]);
' "$ROOT/server/src/fork-schema/supported-versions.json")"
manifest_digest="$(node -e '
  const manifest = require(process.argv[1]);
  const digest = manifest.certification?.officialDigest;
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) process.exit(2);
  process.stdout.write(digest);
' "$ROOT/server/src/fork-schema/supported-versions.json")"

if [[ "$manifest_tag" != 'v3.0.3' ]]; then
  echo "Certified manifest tag must be exactly v3.0.3, received: $manifest_tag" >&2
  exit 1
fi
if [[ -n "${OFFICIAL_IMMICH_TAG:-}" && "$OFFICIAL_IMMICH_TAG" != "$manifest_tag" ]]; then
  echo "OFFICIAL_IMMICH_TAG must match supported-versions.json exactly ($manifest_tag)" >&2
  exit 1
fi
export OFFICIAL_IMMICH_TAG="$manifest_tag"
export FORK_ROUNDTRIP_API_URL="$API_URL"
export FORK_ROUNDTRIP_DATABASE_URL="$DATABASE_URL"
export FORK_ROUNDTRIP_STATE_DIR="$STATE_DIR"
export VITEST_DISABLE_DOCKER_SETUP=true

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
phase() {
  local name="$1" spec="$2"
  local log="$STATE_DIR/$name.log" status
  set +e
  FORK_ROUNDTRIP_PHASE="$name" pnpm --dir "$ROOT" --filter immich-e2e exec vitest --run "$spec" 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "Phase $name failed; durable output: $log" >&2
    return "$status"
  fi
}
wait_healthy() {
  local service="$1" id status
  for _ in {1..120}; do
    id="$(compose ps -a -q "$service")"
    status="$(docker inspect --format '{{if ne .State.Status "running"}}{{.State.Status}}{{else if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
    [[ "$status" == healthy ]] && return 0
    if [[ "$status" == exited || "$status" == dead ]]; then
      compose logs "$service" >&2
      return 1
    fi
    sleep 1
  done
  compose logs "$service" >&2
  echo "$service did not become healthy" >&2
  return 1
}
reset_lane() {
  compose down --volumes --remove-orphans
  rm -rf "$STATE_DIR"
  mkdir -p "$STATE_DIR"
  compose up -d database redis
  wait_healthy database
  wait_healthy redis
}
start_official() {
  compose up -d official-server
  wait_healthy official-server
  local id logs
  id="$(compose ps -q official-server)"
  for _ in {1..120}; do
    logs="$(docker logs --since 5m "$id" 2>&1)"
    grep -Fq 'Immich Microservices is running' <<<"$logs" && return 0
    sleep 1
  done
  docker logs "$id" >&2
  echo 'official-server microservices did not become ready' >&2
  return 1
}
stop_official() { compose stop official-server; }
start_fork() {
  compose up -d fork-server
  wait_healthy fork-server
}
start_fork_normal() {
  start_fork
  local id logs
  id="$(compose ps -q fork-server)"
  for _ in {1..120}; do
    logs="$(docker logs --since 5m "$id" 2>&1)"
    grep -Fq 'Immich Microservices is running' <<<"$logs" && return 0
    sleep 1
  done
  docker logs "$id" >&2
  echo 'fork-server microservices did not become ready after return' >&2
  return 1
}
stop_fork() { compose stop fork-server; }
psql_sql() { compose exec -T database psql -v ON_ERROR_STOP=1 -U postgres -d immich "$@"; }
admin() { compose exec -T fork-server immich-admin "$@"; }

cleanup() {
  if [[ "${FORK_ROUNDTRIP_KEEP_ON_FAILURE:-false}" == true && "${roundtrip_failed:-false}" == true ]]; then
    echo 'Preserving fork-roundtrip containers after failure for diagnosis' >&2
    return
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
on_error() {
  local status="$?"
  roundtrip_failed=true
  echo "Roundtrip failed with status $status at line ${BASH_LINENO[0]}: ${BASH_COMMAND}" >&2
  exit "$status"
}
trap on_error ERR
trap cleanup EXIT

echo "Pulling exact official image ghcr.io/immich-app/immich-server:$OFFICIAL_IMMICH_TAG"
docker pull "ghcr.io/immich-app/immich-server:$OFFICIAL_IMMICH_TAG"
official_digest="$(docker image inspect "ghcr.io/immich-app/immich-server:$OFFICIAL_IMMICH_TAG" --format '{{index .RepoDigests 0}}')"
expected_official_digest="ghcr.io/immich-app/immich-server@$manifest_digest"
[[ "$official_digest" == "$expected_official_digest" ]] || {
  echo "Official image digest mismatch: expected $expected_official_digest, received $official_digest" >&2
  exit 1
}
echo "Official image digest: $official_digest"

compose build fork-server

selected_lane="${FORK_ROUNDTRIP_LANE:-all}"
case "$selected_lane" in
  all|origin-v3.0.3-to-fork|current-fork-to-official-v3.0.3|official-v3.0.3-to-fork-return) ;;
  *) echo "Unknown certification lane: $selected_lane" >&2; exit 1 ;;
esac

if [[ "$selected_lane" == all || "$selected_lane" == origin-v3.0.3-to-fork ]]; then
echo 'Lane: origin-v3.0.3-to-fork'
reset_lane
start_official
phase origin-seed src/specs/server/fork-schema-origin-upgrade.e2e-spec.ts
stop_official
# Run the real fork providers but keep plugin import stopped. The official
# v3.0.3 ledger is already complete, so this applies only isolated fork schema
# setup and gives a pre-plugin-sync digest boundary.
export FORK_DB_SKIP_MIGRATIONS=false FORK_WORKERS_INCLUDE=api
start_fork
phase origin-pre-migrator src/specs/server/fork-schema-origin-upgrade.e2e-spec.ts
stop_fork
export FORK_DB_SKIP_MIGRATIONS=false FORK_WORKERS_INCLUDE=api,microservices
start_fork
phase origin-post-migrator src/specs/server/fork-schema-origin-upgrade.e2e-spec.ts
stop_fork
fi

if [[ "$selected_lane" == all || "$selected_lane" == current-fork-to-official-v3.0.3 || "$selected_lane" == official-v3.0.3-to-fork-return ]]; then
echo 'Lane: current-fork-to-official-v3.0.3'
reset_lane
export FORK_DB_SKIP_MIGRATIONS=false FORK_IMMICH_ENV=development FORK_WORKERS_INCLUDE=api
# A blank database is intentionally classified as an official origin, so the
# first boot establishes the last bundled upstream schema. Prime the simplest
# legacy migration exactly, discard the still-empty isolated schema, and boot
# again: the real unordered legacy provider then applies every other legacy
# migration, including the colliding workflow origin.
start_fork
stop_fork
psql_sql -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA immich_fork CASCADE;
ALTER TYPE "asset_checksum_algorithm_enum" ADD VALUE IF NOT EXISTS 'sha256';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'asset_checksum_algorithm_enum' AND enum_value.enumlabel = 'sha256'
  ) THEN
    RAISE EXCEPTION '2100000000030 schema effect is absent';
  END IF;
END
$$;
INSERT INTO public.kysely_migrations (name, timestamp)
VALUES ('2100000000030-AddSha256ChecksumAlgorithm', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
SQL
start_fork
official_core_container="$(docker create "ghcr.io/immich-app/immich-server:$OFFICIAL_IMMICH_TAG")"
docker cp "$official_core_container:/build/plugins/immich-plugin-core/dist/plugin.wasm" "$STATE_DIR/immich-plugin-core-v3.0.3.wasm"
docker rm "$official_core_container" >/dev/null
official_core_digest="$(node -e "const fs=require('node:fs'),crypto=require('node:crypto'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$STATE_DIR/immich-plugin-core-v3.0.3.wasm")"
[[ "$official_core_digest" == ce2156934a9ce62010b93f551a6963f46668fdcda1aecb14a0b19cc1bdd8afed ]] || {
  echo "Unexpected v3.0.3 core plugin digest: $official_core_digest" >&2
  exit 1
}
docker cp "$STATE_DIR/immich-plugin-core-v3.0.3.wasm" "$(compose ps -q database):/tmp/immich-plugin-core-v3.0.3.wasm"
phase current-fork-seed src/specs/server/fork-schema-current-fork-cutover.e2e-spec.ts
stop_fork
export FORK_WORKERS_INCLUDE=api,microservices
start_fork
phase current-fork-quiescent src/specs/server/fork-schema-current-fork-cutover.e2e-spec.ts

# Process real one-row batches, pause only after a durable partial checkpoint,
# then hard-stop and resume after restart.
printf 'y\n' | compose exec -T fork-server immich-admin fork-schema start --batch-size 1
for _ in {1..600}; do
  partial_count="$(psql_sql -Atc '
    SELECT count(*) FROM immich_fork.backfill_progress
    WHERE processed > 0 AND remaining > 0
  ')"
  [[ "$partial_count" -gt 0 ]] && break
  sleep 0.1
done
[[ "${partial_count:-0}" -gt 0 ]] || { echo 'No partial backfill checkpoint was observed' >&2; exit 1; }
admin fork-schema pause
paused_phase="$(psql_sql -Atc 'SELECT phase FROM immich_fork.state WHERE id = 1')"
[[ "$paused_phase" == legacy ]] || { echo "Backfill did not pause in legacy phase: $paused_phase" >&2; exit 1; }
for _ in {1..600}; do
  active_claims="$(psql_sql -Atc 'SELECT count(*) FROM immich_fork.backfill_progress WHERE "claimToken" IS NOT NULL')"
  [[ "$active_claims" -eq 0 ]] && break
  sleep 0.1
done
[[ "${active_claims:-1}" -eq 0 ]] || { echo 'Backfill claims did not drain before interruption' >&2; exit 1; }
partial_snapshot="$(psql_sql -Atc "
  SELECT jsonb_agg(jsonb_build_object(
    'kind', kind,
    'processed', processed,
    'remaining', remaining,
    'digest', digest
  ) ORDER BY kind)
  FROM immich_fork.backfill_progress
")"
jq -e 'length == 7
  and all(.[]; (.processed + .remaining) == 256)
  and any(.[]; .processed > 0 and .remaining > 0)' <<<"$partial_snapshot" >/dev/null || exit 1
echo "Backfill partial checkpoint: $partial_snapshot"
compose kill -s SIGKILL fork-server
start_fork
restarted_snapshot="$(psql_sql -Atc "
  SELECT jsonb_agg(jsonb_build_object(
    'kind', kind,
    'processed', processed,
    'remaining', remaining,
    'digest', digest
  ) ORDER BY kind)
  FROM immich_fork.backfill_progress
")"
[[ "$restarted_snapshot" == "$partial_snapshot" ]] || { echo 'Backfill checkpoint changed across restart' >&2; exit 1; }
admin fork-schema resume --batch-size 1
resumed_phase="$(psql_sql -Atc 'SELECT phase FROM immich_fork.state WHERE id = 1')"
[[ "$resumed_phase" == dual-write || "$resumed_phase" == ready ]] || {
  echo "Backfill did not resume: $resumed_phase" >&2
  exit 1
}
for _ in {1..120}; do
  status="$(admin fork-schema verify)"
  grep -q 'Verified: yes' <<<"$status" && break
  sleep 1
done
grep -q 'Verified: yes' <<<"${status:-}" || { echo 'Backfill did not verify' >&2; exit 1; }
admin fork-schema-cutover verify-storage start --database-backup-id "$BACKUP_ID" --media-snapshot-id "$SNAPSHOT_ID"
storage_status="$(admin fork-schema-cutover verify-storage resume --database-backup-id "$BACKUP_ID" --media-snapshot-id "$SNAPSHOT_ID" --batch-size 1)"
jq -e '.status == "running" and .verifiedCount > 0 and .verifiedCount < .applicableAssetCount' <<<"$storage_status" >/dev/null || exit 1
compose kill -s SIGKILL fork-server
start_fork
for _ in {1..600}; do
  storage_status="$(admin fork-schema-cutover verify-storage resume --database-backup-id "$BACKUP_ID" --media-snapshot-id "$SNAPSHOT_ID" --batch-size 32)"
  jq -e '.status == "completed"' <<<"$storage_status" >/dev/null && break
done
jq -e '.status == "completed" and .verifiedCount == .applicableAssetCount' <<<"$storage_status" >/dev/null || exit 1

maintenance_output="$(admin enable-maintenance-mode 2>&1)"
echo "$maintenance_output"
grep -q '^Error:' <<<"$maintenance_output" && exit 1
report_digest="$(admin fork-schema-cutover preflight --database-backup-id "$BACKUP_ID" --media-snapshot-id "$SNAPSHOT_ID" --format digest)"
[[ "$report_digest" =~ ^[0-9a-f]{64}$ ]] || { echo 'Cutover preflight did not return a digest' >&2; exit 1; }
cutover_output="$(admin fork-schema-cutover apply --database-backup-id "$BACKUP_ID" --media-snapshot-id "$SNAPSHOT_ID" --report-digest "$report_digest" 2>&1)"
echo "$cutover_output"
grep -q '^Error:' <<<"$cutover_output" && exit 1
phase current-fork-cutover src/specs/server/fork-schema-current-fork-cutover.e2e-spec.ts
handoff_output="$(admin fork-handoff prepare-official 2>&1)"
echo "$handoff_output"
grep -q '^Error:' <<<"$handoff_output" && exit 1
jq -e --arg backup "$BACKUP_ID" --arg snapshot "$SNAPSHOT_ID" '
  .officialImage == "ghcr.io/immich-app/immich-server:v3.0.3"
  and .databaseBackupId == $backup
  and .mediaSnapshotId == $snapshot
  and (.reportDigest | test("^[0-9a-f]{64}$"))
  and (.storageVerificationDigest | test("^[0-9a-f]{64}$"))
  and .storageVerificationAssetCount == 256
' <<<"$handoff_output" >/dev/null || exit 1
stop_fork
set +e
maintenance_output="$(compose run --rm --no-deps --entrypoint immich-admin fork-server disable-maintenance-mode 2>&1)"
maintenance_code=$?
set -e
echo "$maintenance_output"
[[ "$maintenance_code" -eq 0 ]] || exit "$maintenance_code"
grep -q '^Error:' <<<"$maintenance_output" && exit 1
start_official
phase current-fork-official src/specs/server/fork-schema-current-fork-cutover.e2e-spec.ts

if [[ "$selected_lane" == all || "$selected_lane" == official-v3.0.3-to-fork-return ]]; then

echo 'Lane: official-v3.0.3-to-fork-return'
# The return lane intentionally continues from the certified cutover database.
# Seed the origin state file with the current auth/workflow identifiers used by
# the official API phase.
cp "$STATE_DIR/current-fork-to-official-v3.0.3.json" "$STATE_DIR/origin-v3.0.3-to-fork.json"
phase official-operations-before-restart src/specs/server/fork-schema-roundtrip.e2e-spec.ts
stop_official
start_official
phase official-operations-after-restart src/specs/server/fork-schema-roundtrip.e2e-spec.ts
official_token="$(jq -r '.admin.accessToken' "$STATE_DIR/origin-v3.0.3-to-fork.json")"
curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $official_token" \
  --header 'Content-Type: application/json' \
  --data '{"action":"start"}' \
  "$API_URL/admin/maintenance"
for _ in {1..60}; do
  official_maintenance="$(psql_sql -Atc "SELECT coalesce((value->>'isMaintenanceMode')::boolean, false) FROM public.system_metadata WHERE key = 'maintenance-mode'")"
  [[ "$official_maintenance" == t ]] && break
  sleep 0.1
done
[[ "${official_maintenance:-f}" == t ]] || { echo 'Official API did not enable maintenance mode' >&2; exit 1; }
stop_official
export FORK_IMMICH_ENV=production FORK_DB_SKIP_MIGRATIONS=false FORK_WORKERS_INCLUDE=api,microservices
# Startup validates the exact official ledger before any provider runs.
start_fork
set +e
fork_return_output="$(admin fork-handoff prepare-fork --batch-size 1 2>&1)"
fork_return_code=$?
set -e
echo "$fork_return_output"
[[ "$fork_return_code" -eq 0 ]] || exit "$fork_return_code"
grep -q '^Error:' <<<"$fork_return_output" && exit 1
jq -e '
  .active == true
  and .phase == "active"
  and .schemaVersion == "2"
  and .reconciliationStatus == "complete"
  and .verified == true
  and (.progress | length == 7)
  and all(.progress[]; .remaining == 0 and .cursor == null and .lastError == null)
' <<<"$fork_return_output" >/dev/null || { echo 'Fork return did not report completed activation' >&2; exit 1; }
stop_fork
set +e
maintenance_output="$(compose run --rm --no-deps --entrypoint immich-admin fork-server disable-maintenance-mode 2>&1)"
maintenance_code=$?
set -e
echo "$maintenance_output"
[[ "$maintenance_code" -eq 0 ]] || exit "$maintenance_code"
grep -q '^Error:' <<<"$maintenance_output" && exit 1
fork_maintenance="$(psql_sql -Atc "SELECT coalesce((value->>'isMaintenanceMode')::boolean, false) FROM public.system_metadata WHERE key = 'maintenance-mode'")"
[[ "$fork_maintenance" == f ]] || { echo 'Fork return did not leave maintenance mode' >&2; exit 1; }
start_fork_normal
phase fork-return src/specs/server/fork-schema-roundtrip.e2e-spec.ts
fi
fi

echo "Local synthetic certification completed for: $selected_lane"
