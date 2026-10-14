# Releasing

Releases go to npm as `@bounded-authority/client`. Every release after the first is staged by the
[release workflow](.github/workflows/release.yml) and approved by a maintainer. The first release
is published by hand, because npm's staged publishing and trusted publishing both need the
package to exist on npm already (npm 11.17 documentation for `npm stage` and `npm trust`, section
"Prerequisites").

You need an npm account with two-factor authentication and write access to the
`@bounded-authority` scope, the GitHub CLI (`gh`), and Node.js 24.19.0 (npm 11.5 or later).

## The first release (0.1.1), by hand

1. **Verify and pack on CI.** Run the release workflow on `main` by hand. Without a tag it runs
   only its verify job: every check on one packed tarball, which it uploads with its SHA-256.

   ```bash
   gh workflow run release.yml --ref main
   gh run list --workflow release.yml --limit 1   # note the run ID; wait for it to succeed
   gh run download <run-id> --name release-tarball
   sha256sum bounded-authority-client-0.1.1.tgz    # must equal the SHA-256 the "Pack the tree" step printed
   ```

2. **Publish that tarball.** No `--provenance`: npm generates provenance only inside a supported
   CI job, not on a workstation. npm asks for your two-factor code.

   ```bash
   npm login
   npm publish bounded-authority-client-0.1.1.tgz --access public
   npm view @bounded-authority/client@0.1.1 version   # prints 0.1.1
   ```

3. **Turn on trusted publishing for staged releases.** This lets the release workflow, and only it,
   stage later versions. npm asks for your two-factor code.

   ```bash
   npm trust github @bounded-authority/client --file release.yml \
     --repository baselabs/bounded-authority-client-ts --allow-stage-publish
   npm trust list @bounded-authority/client
   ```

4. **Tag the published commit.** Tag the commit the workflow run in step 1 packed, and push the
   tag. The release workflow verifies it, finds 0.1.1 on the registry, and stages nothing.

   ```bash
   git tag v0.1.1 <commit>
   git push origin v0.1.1
   ```

5. **Update the docs.** In the README's Install section, replace the from-source steps (from
   "Not published yet" through the `npm install ../bounded-authority-client-ts/...` block) with
   `npm install @bounded-authority/client`, and give the CHANGELOG's 0.1.1 heading its date.

## Every later release (staged)

1. Set the new version in `package.json`, give the CHANGELOG section that version and its date,
   and commit to `main`. CI must be green.
2. Tag that commit `v<version>` and push the tag. The release workflow packs and verifies the
   tree, then stages that exact tarball with provenance (`npm stage publish`). A pre-release
   version such as `0.2.0-beta.1` is staged under the dist-tag `beta`.
3. Approve the staged version on npmjs.com, or with `npm stage approve <stage-id>` (the stage ID is
   in the workflow log). npm asks for your two-factor code. Reject it with `npm stage reject
   <stage-id>` instead if something is wrong.

A rerun for a version that is already published ends with a notice. A rerun for a version that is
staged but not yet approved fails: approve or reject the staged version first.
