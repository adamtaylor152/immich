# Fork CI runners

Enabled jobs use `[self-hosted, Linux, X64, aiimmich]`, with no GitHub-hosted
fallback. Jobs are restricted to `adamtaylor152/immich` and reject PR heads from
other repositories. Keep repository access and external-contributor workflow
approval restrictions enabled in GitHub runner/Actions settings; workflow guards
alone are not a sandbox against an attacker who can edit workflows.

Windows CLI tests and iOS builds are explicitly disabled by owner request until
matching self-hosted runners exist. Restore their original filter/signing checks
when enabling those jobs. Native tests cover x64 only; ARM64 container images
are built with QEMU emulation on the same x64 host.

The runner needs the existing Linux build tooling (Docker/Compose/Buildx, Git,
Node, shell tools, and any SDK system prerequisites). Jobs install their usual
workspace/toolchain dependencies. A single runner executes one job at a time;
expect formerly parallel CI to queue. E2E jobs clean up only their dedicated
Compose project and test volumes, and SQL checks use a dynamically allocated
PostgreSQL host port.

## Provisioning `aiimmich`

Build the fork runner image on its Docker host:

```sh
docker build -t immich-ci-runner:noble-20260905 .github/runner
```

The pinned Noble base supplies glibc 2.39, required by the current `extism-js`
binary. The image also installs `python` and PyYAML for the shared pre-job action.
The upstream runner's `latest` tag currently uses Focal/glibc 2.31 and is not
compatible with this toolchain.

The dedicated `Github_ImmichBuilder` container must use host networking and
`RUNNER_WORKDIR=/mnt/shaganappi/appdata/github_aiimmich/work`, with that exact path
bind-mounted at the same path inside the runner. Docker actions need the shared
workspace; test processes need access to services published on host loopback.
This runner already has the host Docker socket: keep it restricted to trusted
fork jobs, not arbitrary public PR code.

Keep `REPO_URL=https://github.com/adamtaylor152/immich`, `RUNNER_SCOPE=repo`, and
the existing labels. Persist runner registration separately at
`/mnt/shaganappi/appdata/github_aiimmich/persistent_files_noble`, mounted at
`/runner/persistent_files`, with `CONFIGURED_ACTIONS_RUNNER_FILES_DIR` pointing
there and `DISABLE_AUTOMATIC_DEREGISTRATION=true`. Changing the work directory
requires fresh registration; reusing the old persisted `.runner` retains `/`.
Never commit registration tokens or credentials.

After provisioning, verify the actual container before rerunning CI:

```sh
docker exec -i -e RUNNER_SMOKE_IMAGE=immich-ci-runner:noble-20260905 \
  Github_ImmichBuilder bash -s < .github/runner/check.sh
```

The check exercises Python/PyYAML/glibc, Docker tooling, a real workspace bind
mount and HTTP access to a dynamically published service. It removes only its
own temporary container and directory. It does not validate the full app suite.

The Unraid template must retain the same image, networking, workspace and
registration mount settings. The initial Focal container was retained, stopped,
as `Github_ImmichBuilder-focal-backup-d68940d75`; its template backup is
`/mnt/shaganappi/appdata/github_aiimmich/template-focal-d68940d75.xml`.
Never run both containers concurrently. Rollback also requires verifying the
GitHub registration because the replacement registers with the same runner name.

Release jobs accept only successful same-repository pushes to `fork/main` or
manual dispatches on that branch. Before checkout, the GitHub API must confirm
that the release SHA belongs to the current `fork/main` history; API failures
stop the release. Third-party actions are pinned to immutable commit SHAs.

Run `node .github/check-runners.cjs` and `node .github/check-release.cjs` after installing workspace dependencies,
and `actionlint -shellcheck='' -pyflakes=''` to validate runner policy and workflow
syntax. The policy check also runs in the GitHub-files validation job.

Routing is versioned with each workflow. Rerunning an old commit does not adopt
these changes. Default-branch events (including `pull_request_target`, schedules,
and `workflow_run`) adopt the routing only after it lands on `fork/main`.
