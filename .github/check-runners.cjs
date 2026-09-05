// Run with: node .github/check-runners.cjs (after installing workspace dependencies).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
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
    if (job.uses) {
      assert.ok(
        job.uses.startsWith("./.github/workflows/"),
        `${location}: external workflow controls its own runners`,
      );
      continue;
    }
    if (job.if === false || job.if?.startsWith("${{ false &&")) {
      assert.ok(
        job["runs-on"].includes("self-hosted"),
        `${location}: disabled platform must not fall back to hosted`,
      );
      continue;
    }
    assert.deepEqual(
      job["runs-on"],
      ["self-hosted", "Linux", "X64", "aiimmich"],
      `${location}: wrong runner`,
    );
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
const imageBuild = load(
  fs.readFileSync(path.join(workflows, "local-multi-runner-build.yml"), "utf8"),
);
const matrixStep = imageBuild.jobs.matrix.steps.find(
  (step) => step.id === "matrix",
);
for (const [platforms, expected] of [
  [
    "linux/amd64,linux/arm64",
    [{ platform: "linux/amd64" }, { platform: "linux/arm64" }],
  ],
  ["linux/arm64", [{ platform: "linux/arm64" }]],
]) {
  const output = execFileSync("bash", ["-e", "-c", matrixStep.run], {
    env: { ...process.env, PLATFORMS: platforms, GITHUB_OUTPUT: "/dev/null" },
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(output.trim().slice("matrix=".length)), expected);
}
console.log(
  `Runner policy passed for ${checked} Linux job definitions and both image-build matrices.`,
);
