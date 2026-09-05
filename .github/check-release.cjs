// Exercise the release workflow's admission expression and pre-checkout script.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { load } = createRequire(
  path.resolve(__dirname, "../server/package.json"),
)("js-yaml");
const { release } = load(
  fs.readFileSync(path.join(__dirname, "workflows/fork-release.yml"), "utf8"),
).jobs;
const repository = "adamtaylor152/immich";
const sha = "a".repeat(40);
const run = {
  event: "push",
  conclusion: "success",
  head_repository: { full_name: repository },
  head_branch: "fork/main",
  head_sha: sha,
};

// This expression uses only boolean/string operators shared by JavaScript and Actions.
for (const [event_name, ref, workflow_run, allowed] of [
  [
    "workflow_run",
    "refs/heads/fork/main",
    { ...run, event: "pull_request" },
    false,
  ],
  [
    "workflow_run",
    "refs/heads/fork/main",
    { ...run, head_repository: { full_name: "attacker/immich" } },
    false,
  ],
  [
    "workflow_run",
    "refs/heads/fork/main",
    { ...run, head_branch: "feature" },
    false,
  ],
  [
    "workflow_run",
    "refs/heads/fork/main",
    { ...run, conclusion: "failure" },
    false,
  ],
  ["workflow_run", "refs/heads/fork/main", run, true],
  ["workflow_dispatch", "refs/heads/fork/main", undefined, true],
  ["workflow_dispatch", "refs/heads/feature", undefined, false],
]) {
  const allowedByWorkflow = vm.runInNewContext(
    release.if.replace(/^\$\{\{|\}\}$/g, ""),
    {
      github: { repository, event_name, ref, event: { workflow_run } },
    },
  );
  assert.equal(
    allowedByWorkflow,
    allowed,
    `${event_name}/${workflow_run?.event}/${workflow_run?.head_branch}`,
  );
}

(async () => {
  const resolve = release.steps.findIndex((step) => step.id === "sha");
  const checkout = release.steps.findIndex((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.ok(
    resolve >= 0 && resolve < checkout,
    "verify provenance before checkout",
  );
  for (const status of [
    "ahead",
    "identical",
    "behind",
    "diverged",
    "api-error",
  ]) {
    const outputs = {};
    const execution = vm.runInNewContext(
      `(async () => { ${release.steps[resolve].with.script} })()`,
      {
        context: {
          eventName: "workflow_run",
          payload: { workflow_run: run },
          repo: { owner: "adamtaylor152", repo: "immich" },
        },
        core: {
          setOutput: (key, value) => {
            outputs[key] = value;
          },
        },
        github: {
          rest: {
            git: {
              getRef: async () => ({
                data: { object: { sha: "b".repeat(40) } },
              }),
            },
            repos: {
              compareCommitsWithBasehead: async ({ basehead }) => {
                assert.equal(basehead, `${sha}...${"b".repeat(40)}`);
                if (status === "api-error") throw new Error("unavailable");
                return { data: { status } };
              },
            },
          },
        },
      },
    );
    if (["ahead", "identical"].includes(status)) {
      await execution;
      assert.deepEqual(outputs, { sha });
    } else {
      await assert.rejects(execution);
      assert.deepEqual(outputs, {});
    }
  }
  console.log(
    "Release admission and fail-closed pre-checkout ancestry checks passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
