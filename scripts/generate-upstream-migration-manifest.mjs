import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const tag = process.argv[2];
if (!tag?.match(/^v\d+\.\d+\.\d+$/)) {
  throw new Error("Usage: generate-upstream-migration-manifest.mjs v3.0.3");
}

const output = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", tag, "server/src/schema/migrations"],
  {
    encoding: "utf8",
  },
);
const upstreamMigrations = output
  .trim()
  .split("\n")
  .map((path) => path.split("/").at(-1)?.replace(/\.ts$/, ""))
  .filter(Boolean)
  .toSorted();

writeFileSync(
  "server/src/fork-schema/supported-versions.json",
  JSON.stringify(
    { ranges: [">=3.0.0 <4.0.0"], certifiedTags: [tag], upstreamMigrations },
    null,
    2,
  ) + "\n",
);
