# GitHub releases

Cordyceps is initially versioned **0.0.1-alpha**. The release workflow attaches
an installable npm tarball directly to a GitHub release; an npm registry account
or npm publication is not required. Consumers need Node.js 22 or later. Bun is
only needed to develop and build this repository.

## Install a release

After `v0.0.1-alpha` has been published, run this in the consuming application:

```sh
npm install --save-dev https://github.com/trevordilley/cordyceps/releases/download/v0.0.1-alpha/cordyceps.tgz
```

Or download the package and checksum first:

```sh
curl --fail --location --output cordyceps.tgz https://github.com/trevordilley/cordyceps/releases/download/v0.0.1-alpha/cordyceps.tgz &&
curl --fail --location --output SHA256SUMS https://github.com/trevordilley/cordyceps/releases/download/v0.0.1-alpha/SHA256SUMS &&
shasum -a 256 -c SHA256SUMS &&
npm install --save-dev ./cordyceps.tgz
```

On Linux, `sha256sum -c SHA256SUMS` can replace the `shasum` command. The checksum
detects mismatched or damaged downloads; it is not a separate publisher signature.
When installing the local tarball, keep it at the saved dependency path for
subsequent installs. The direct release URL is convenient for committed manifests
and lockfiles because other machines can fetch it too.

Import from `cordyceps` as usual. To use `cordyceps/playwright`, also install
`@playwright/test` as a dev dependency. Agent binaries remain consumer-installed.

Every release includes its own versioned installation commands. Once a stable
release exists, this URL selects GitHub's latest stable release:

```sh
npm install --save-dev https://github.com/trevordilley/cordyceps/releases/latest/download/cordyceps.tgz
```

Prereleases never replace that stable channel. Use an exact version URL for
reproducible dependencies and prerelease testing. The latest-stable URL will not
work while the repository only has prereleases. These are workflow-generated
assets, not GitHub's automatic source archives, which do not contain `dist/`.

## Cut a prerelease or stable release

1. Set `package.json` to the intended version and commit the change. The current
   version is `0.0.1-alpha`; later candidates can use `0.0.1-alpha.1`,
   `0.0.1-alpha.2`, or `0.0.1-rc.1`. A stable version has no suffix, such as `0.0.1`.
2. Push the reviewed commit and an annotated tag whose version matches exactly:

   ```sh
   git tag -a v0.0.1-alpha -m 'Cordyceps 0.0.1-alpha'
   git push origin HEAD
   git push origin v0.0.1-alpha
   ```

3. Watch the **Release** workflow. The tag must contain the release workflow and
   its supporting scripts. A tag containing a prerelease suffix creates a GitHub
   prerelease; a tag without one creates a stable release. No npm registry publish
   step runs.

The workflow first rejects malformed tags, branch-based dispatches, and versions
that disagree with `package.json`. Supported tags use `vMAJOR.MINOR.PATCH` with
an optional SemVer prerelease suffix (no build metadata).

It then calls the existing CI workflow at the tagged commit: both Node library
jobs and all eleven real-consumer groups must pass. The package verifier retains
the exact tarball installed in its clean Node and Playwright consumers. Only
after all jobs pass does the publishing job download the Node 22 artifact from
the same workflow run, check its embedded package version, and attach:

- `cordyceps.tgz`: the verified npm package, with a fixed download filename.
- `SHA256SUMS`: the SHA-256 digest of that package.
- Release notes containing installation commands and GitHub-generated changes.

No rebuild or repack happens in the publishing job. Only that job has
`contents: write`; verification jobs have read-only repository access. The
workflow uses `GITHUB_TOKEN`, so no npm token or new repository secret is needed.
The standard runner's GitHub CLI creates a draft, uploads the assets, and then
publishes it. Existing releases are not overwritten.

For a failure before release creation, rerun the failed workflow jobs. To start
a fresh run for an existing tag after the workflow is on the default branch:

```sh
gh workflow run release.yml --ref v0.0.1-alpha
```

Manual runs must select a version tag, not `main`. If an upload failure left a
draft, inspect and remove that incomplete draft in GitHub before retrying; keep
the tag. For a published release, make any correction in a new version instead
of replacing its package asset.
