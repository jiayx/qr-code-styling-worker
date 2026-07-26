import packageJson from "../package.json" with { type: "json" };

const releaseTag = process.argv[2] || process.env.GITHUB_REF_NAME;
if (!releaseTag) {
  throw new Error("A release tag is required");
}

const expectedTag = `v${packageJson.version}`;
if (releaseTag !== expectedTag) {
  throw new Error(
    `Release tag ${releaseTag} does not match package version ${packageJson.version}; expected ${expectedTag}`,
  );
}

console.log(`${releaseTag} matches ${packageJson.name}@${packageJson.version}`);
