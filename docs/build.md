# Build

A workflow builds the files nightly and deploys them to GitHub Pages.

## Updates

- **Incremental:** each build starts from the published `v1/<tool>.full.json` files. The deploy replaces the whole site, so the per-version files can't be fetched again.
- Known versions, files and release times are reused. Only missing ones are fetched.
- Versions gone upstream stay listed.
- Paged sources stop at the first known version. A full refresh fills older gaps.
- **Full refresh:** run the `pages` workflow with the `full` input, or `pnpm build --full`.

## Failures

- A missing checksum (404) skips the file.
- Other errors warn, the next build retries.
- A tool whose fetch fails republishes its previous file with the old `updatedAt`.
- The build only fails for a tool without any versions.

## Job summary

When `GITHUB_STEP_SUMMARY` is set, as in GitHub Actions, each build appends a summary:

- the build kind and duration
- which tools were updated, kept their previous file or failed
- the download budget
- a table with a row per tool: versions, new versions, files added, computed checksums and bytes, warnings
- the warnings and errors of each tool

The log lines (`::warning::`, `::error::`, `::notice::`) stay as they are.

## Release trigger

- Renovate updates [`renovate.Dockerfile`](../renovate.Dockerfile), one line per maintained major (per minor for some tools).
- The automerged update publishes a release right away.
- GitHub releases wait until they are 2 hours old, when all their assets are uploaded. Other datasources, like docker, have no release times to wait for.
- Add new lines when new versions are released.

## Release archive

`pnpm pack:release` packs the client files of the build output into `dist-release/`, see [the format](./format.md#release-archive) for the content:

- `tool-versions-<version>.tar.xz`, made with `tar` and `xz`
- `tool-versions-<version>.tar.xz.sha512`
- `release-notes.md`

The pages workflow runs it after the build and adds the number of files and the packed and unpacked size to the job summary.

- **Previous release:** the `build` job downloads the latest release, verifies its `.sha512`, extracts it and passes it as `--previous`. The tags of all releases are passed as `--published`, and the commit subjects since its tag as `--commits`.
- **When:** a release is due when there is no release yet, or the data changed. The pack step writes `changed` and `version` to the outputs of the job and the `build` job uploads `dist-release/` as the artifact `release`.
- **Release job:** the `release` job runs on `main` after the `build` and `deploy` jobs, so a release always matches the deployed site. It downloads the artifact and runs `gh release create v<version>` for the commit with the notes and the two archive files. It is the only job with `contents: write`.
- **First release:** `1.0.0`.

- **Versions:** a data change is a patch release. The base `major.minor` is `releaseBase` in [`src/release.ts`](../src/release.ts), set by hand. A new major version is for a breaking change of the format or the archive, a new minor version for new fields or files.
- The next version is the latest published patch version of the base plus one, or `<major>.<minor>.0` when there is none yet, like after a bump of the base. `--published <tag>` passes the versions or tags of the existing releases.
- **Data change:** the new files differ from the previous release in other than the `updatedAt` of the files and the digests which follow from it. `--previous <folder>` has the extracted archive of the previous release.
- **Tags:** a release is tagged `v<version>`, like `v1.0.3`.
- **Release notes:** the header with the version and date, the data changes (versions added and removed per tool, at most 10 listed, new and removed tools on their own line) and the code changes: the conventional commits since the previous tag (`--commits <file>` has their subjects, one per line), as features, bug fixes, performance improvements, reverts, breaking changes and other (`refactor`, `docs`), each with its pull request number. `chore`, `ci`, `test` and `build` commits aren't listed.

## Environment

- `GITHUB_TOKEN` avoids the GitHub rate limit.
- `TOOL_VERSIONS_URL` overrides where the previous files come from.
- `TOOL_VERSIONS_DOWNLOAD_BUDGET` sets the download budget, see [sources](./sources.md#download-budget).
