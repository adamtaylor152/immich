// Run with: node .github/check-runners.cjs (after installing workspace dependencies).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { runInNewContext } = require("node:vm");
const { load } = createRequire(
  path.resolve(__dirname, "../server/package.json"),
)("js-yaml");

const workflows = path.join(__dirname, "workflows");
let checked = 0;
for (const file of fs
  .readdirSync(workflows)
  .filter((name) => /\.ya?ml$/.test(name))) {
  const workflow = load(fs.readFileSync(path.join(workflows, file), "utf8"));
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const location = `${file}: ${id}`;
    for (const step of job.steps || []) {
      if (step.uses && !step.uses.startsWith("./")) {
        assert.match(
          step.uses,
          /@[0-9a-f]{40}$/,
          `${location}: action must be commit-pinned`,
        );
      }
    }
    if (job.uses) {
      assert.ok(
        job.uses.startsWith("./.github/workflows/"),
        `${location}: external workflow controls its own runners`,
      );
      continue;
    }
    const runner = job["runs-on"];
    if (file === "local-multi-runner-build.yml" && id === "build") {
      assert.equal(
        runner,
        "${{ matrix.runner }}",
        `${location}: use native architecture runner`,
      );
    } else {
      assert.ok(
        ["ubuntu-24.04", "windows-latest", "macos-26"].includes(runner),
        `${location}: must use a GitHub-hosted runner`,
      );
    }
    assert.ok(
      job.if?.includes("github.repository == 'adamtaylor152/immich'") &&
        job.if?.includes(
          "!github.event.pull_request || github.event.pull_request.head.repo.full_name == github.repository",
        ),
      `${location}: missing same-repository admission guard`,
    );
    checked++;
  }
}
const iosBuild = load(
  fs.readFileSync(path.join(workflows, "build-mobile.yml"), "utf8"),
).jobs["build-sign-ios"];
for (const [headRepo, mobile, signing, expected] of [
  ["adamtaylor152/immich", true, "true", true],
  ["external/immich", true, "true", false],
  ["adamtaylor152/immich", false, "true", false],
  ["adamtaylor152/immich", true, "false", false],
]) {
  assert.equal(
    runInNewContext(iosBuild.if.slice(3, -2), {
      github: {
        repository: "adamtaylor152/immich",
        event: {
          pull_request: { head: { repo: { full_name: headRepo, fork: true } } },
        },
      },
      needs: {
        "pre-job": { outputs: { should_run: JSON.stringify({ mobile }) } },
        "check-signing-secrets": { outputs: { "has-ios": signing } },
      },
      fromJSON: JSON.parse,
    }),
    expected,
    "iOS admission must allow trusted fork branches while preserving change/signing gates",
  );
}
const imageBuild = load(
  fs.readFileSync(path.join(workflows, "local-multi-runner-build.yml"), "utf8"),
);
const matrixStep = imageBuild.jobs.matrix.steps.find(
  (step) => step.id === "matrix",
);
for (const [platforms, expected] of [
  [
    "linux/amd64,linux/arm64",
    [
      { platform: "linux/amd64", runner: "ubuntu-24.04" },
      { platform: "linux/arm64", runner: "ubuntu-24.04-arm" },
    ],
  ],
  ["linux/arm64", [{ platform: "linux/arm64", runner: "ubuntu-24.04-arm" }]],
]) {
  const output = execFileSync("bash", ["-e", "-c", matrixStep.run], {
    env: { ...process.env, PLATFORMS: platforms, GITHUB_OUTPUT: "/dev/null" },
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(output.trim().slice("matrix=".length)), expected);
}
assert.throws(() =>
  execFileSync("bash", ["-e", "-c", matrixStep.run], {
    env: {
      ...process.env,
      PLATFORMS: "linux/ppc64le",
      GITHUB_OUTPUT: "/dev/null",
    },
    stdio: "pipe",
  }),
);
console.log(
  `Runner policy passed for ${checked} hosted job definitions and native image-build matrices.`,
);
