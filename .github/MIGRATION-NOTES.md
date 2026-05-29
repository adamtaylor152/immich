# Workflow migration notes (fork-maintainer follow-ups)

Steps that require GitHub UI/API access outside of code-review scope. Each
section is self-contained and includes the exact reason, the exact change to
make, and the workflow file that consumes the result.

---

## 1. GitHub App for `fix-format.yml` commit push

### Why

`.github/workflows/fix-format.yml:33` uses `actions/checkout` with
`persist-credentials: true`. The committed-back step
(`EndBug/add-and-commit`) needs git auth to `git push` the formatting commit
to the PR's head branch. The current path persists the default `GITHUB_TOKEN`
in the checkout's `.git/config`, which a same-repo collaborator with `pull-requests:
write` + `contents: write` can exfiltrate by mutating a workspace's
`format:fix` script and labeling their PR `fix:formatting`.

The job-level `if: github.event.pull_request.head.repo.fork == false` guard
limits the abuser pool to existing same-repo collaborators (the existing
trust model). The residual surface is documented in the workflow at lines
48-61.

The long-term fix is to mint a scoped GitHub App token at job-runtime and
drop `persist-credentials: true`. The token's scope is narrow
(`contents: write` on this repo only, time-limited to the job's duration),
so a leaked token has a small blast radius and no cross-repo reach.

### Manual steps (one-time)

1. Visit `https://github.com/settings/apps/new` (for a personal app) or your
   org's `Settings → Developer settings → GitHub Apps → New GitHub App` page.

2. Fill in:
   - **GitHub App name**: `immich-fork-formatter` (or whatever fork prefix
     you use)
   - **Homepage URL**: link to this repo
   - **Webhook**: uncheck "Active" — this app pulls, no webhook needed
   - **Repository permissions**:
     - `Contents`: **Read & write**
     - `Pull requests`: **Read & write** (only if you want the bot to also
       remove the `fix:formatting` label; otherwise read)
     - everything else: **No access**
   - **Where can this GitHub App be installed?**: **Only on this account**

3. Click **Create GitHub App**.

4. On the app's settings page, scroll to **Private keys** → **Generate a
   private key**. A `.pem` file downloads — keep it locally for step 6.

5. On the same page, note the **App ID** (top of the page) — you'll need it.

6. Install the app on this repository:
   - Click **Install App** in the left sidebar
   - Choose your account/org
   - Choose **Only select repositories** → select `adamtaylor152/immich`
     (and any other forks you maintain)
   - Click **Install**

7. Add the App ID and private key as repository secrets:
   ```bash
   gh secret set FORK_FORMATTER_APP_ID --body "<the-app-id>"
   gh secret set FORK_FORMATTER_PRIVATE_KEY < downloaded-private-key.pem
   ```
   Or via the GitHub UI: `Settings → Secrets and variables → Actions → New
repository secret`.

### Code change (apply after secrets exist)

Replace the checkout step in `.github/workflows/fix-format.yml`:

```yaml
      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@<pinned-sha>  # tj-actions equivalent
        with:
          app-id: ${{ secrets.FORK_FORMATTER_APP_ID }}
          private-key: ${{ secrets.FORK_FORMATTER_PRIVATE_KEY }}

      - name: Checkout code
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          persist-credentials: false           # was: true
          token: ${{ steps.app-token.outputs.token }}  # was: github.token

      ...

      - name: Commit and push
        uses: EndBug/add-and-commit@290ea2c423ad77ca9c62ae0f5b224379612c0321 # v10.0.0
        with:
          default_author: github_actions
          message: 'chore: fix formatting'
          github_token: ${{ steps.app-token.outputs.token }}  # explicit
```

Drop the `KNOWN RESIDUAL SURFACE` comment block at lines 48-61 (or trim it
to a one-line "previously: `persist-credentials: true`; now scoped App
token" historical note).

### Verification

After the migration, a malicious `format:fix` script that exfiltrates
`process.env.GITHUB_TOKEN` finds an App token scoped to
`contents:write + pull-requests:write` on this repo only, with a ~1-hour
expiry. The attacker cannot cross-repo, cannot escalate to organization
settings, and the token becomes invalid before they can persist anywhere
useful. Combined with `--ignore-scripts` (line 63), the residual RCE
surface is minimal.

---

## 2. Branch-protection required check for `Zizmor`

### Why

`.github/workflows/org-zizmor.yml` now has two jobs both named `Zizmor`,
mutually exclusive via `if:` conditions on `github.repository_owner`. The
fork side (`zizmor-skipped`) posts a passing status under the exact
required-check name so branch protection on the fork is satisfied.

If your fork's `main` (or `fork/main`) branch protection rule lists `Zizmor`
as a required status check, this is already correct after the round-2 fix.

### Manual steps (if not already set up)

If you want to enforce Zizmor for upstream and have it auto-pass on fork:

1. Go to `Settings → Branches → Branch protection rules → Edit rule for
fork/main` (or whichever branch you protect).

2. Under **Require status checks to pass before merging**, type `Zizmor`
   in the search box and select it. The exact-string match is essential:
   `Zizmor (skipped on fork)` would be a _different_ check and would not
   be satisfied by either job.

3. Save.

---

## 3. SLSA provenance attestation step (future enhancement)

### Why

`.github/workflows/nsfw-unraid-docker.yml` now has `id-token: write` and
`provenance: mode=min`. BuildKit produces unsigned provenance metadata
embedded in the image manifest. The next conservative step is to add
`actions/attest-build-provenance` to upload a _signed_ SLSA attestation to
Sigstore that consumers can verify with `gh attestation verify` or `cosign`.

### Manual steps (optional)

No GitHub UI changes are required — the OIDC trust between GitHub and
Sigstore is already configured by `id-token: write`. The change is code-only:

```yaml
- name: Attest build provenance
  uses: actions/attest-build-provenance@<pinned-sha>
  with:
    subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/immich-server
    subject-digest: ${{ steps.build.outputs.digest }}
    push-to-registry: true
```

Add `id: build` to the existing `docker/build-push-action` step so
`steps.build.outputs.digest` resolves. Repeat for the ML build job.

Consumers verify with:

```bash
gh attestation verify oci://ghcr.io/adamtaylor152/immich-server:commit-<sha> \
  --owner adamtaylor152
```

This was deferred from round 2 to keep that round's scope narrow. The
permission groundwork (`id-token: write`) is in place; adding the attest
step is purely additive.

---

## 4. Self-hosted runner group ACL (operational, not code)

### Why

`.github/actionlint.yaml:1-9` documents that labels in actionlint.yaml only
teach the linter that labels exist — they don't control which workflows can
_reach_ the runner pool. That ACL is configured in the GitHub UI.

### Manual steps

1. Go to `Settings → Actions → Runner groups → aiimmich` (or whatever name
   your fork's runner group uses).

2. Under **Repository access**, select **Selected repositories** and add
   `adamtaylor152/immich` only. Remove any wildcards or other repos.

3. Under **Workflow access**, leave at the default (all workflows from the
   selected repos) — the workflow-level `if:` guards in
   `local-multi-runner-build.yml:111-114` and `nsfw-unraid-docker.yml:27,95`
   are defense-in-depth and assume the operational ACL is in place.

4. Save.

This is a one-time setup. The runner-mapping validation in
`local-multi-runner-build.yml`'s `matrix` job catches misconfigured callers
_before_ the build job dispatches, but the operational ACL is the actual
gate.

---

## 5. Drop `persist-credentials: true` from any remaining workflow (audit)

Run this periodically:

```bash
grep -rn 'persist-credentials: true' .github/workflows/
```

After step 1 (GitHub App migration), the only acceptable occurrences are
workflows that genuinely need git-push credentials and have a same-repo
fork guard (`github.event.pull_request.head.repo.fork == false`) PLUS an
explicit comment explaining why the residual is acceptable. As of
2026-05-28 the only such file is `fix-format.yml`.
