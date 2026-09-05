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
