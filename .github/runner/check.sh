#!/usr/bin/env bash
# Run inside the dedicated fork runner after provisioning, before accepting jobs.
set -euo pipefail

python -c 'import platform, yaml; assert tuple(map(int, platform.libc_ver()[1].split("."))) >= (2, 39); print("Python, PyYAML and glibc: OK")'
docker compose version
docker buildx version

: "${RUNNER_WORKDIR:?Set the dedicated, same-path bind-mounted runner work directory}"
: "${RUNNER_SMOKE_IMAGE:?Set the locally built runner image}"
test "$RUNNER_WORKDIR" != /
probe_dir=$(mktemp -d "$RUNNER_WORKDIR/runner-smoke.XXXXXX")
probe_container=''
trap 'if [[ -n "$probe_container" ]]; then docker rm -f "$probe_container" >/dev/null; fi; rmdir "$probe_dir"' EXIT

# A Docker action must see exactly the same workspace as the runner process.
docker run --rm --entrypoint test --mount "type=bind,source=$probe_dir,target=/probe,readonly" "$RUNNER_SMOKE_IMAGE" -d /probe

# Services publish ports on the Docker host, not on an isolated runner bridge.
probe_container=$(docker run -d --entrypoint python --publish 127.0.0.1::8080 "$RUNNER_SMOKE_IMAGE" -m http.server 8080 --directory /tmp)
probe_address=$(docker port "$probe_container" 8080/tcp)
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --max-time 5 "http://$probe_address/" >/dev/null
echo 'Docker workspace visibility and host service connectivity: OK'
