# Build

A workflow builds the files nightly, deploys them to GitHub Pages and creates a release when the data changed. A push to `main` only deploys, unless its commits warrant a release, see [the release archive](#release-archive).

## Nightly flow

The `pages` workflow runs on every push to `main`, nightly and on demand.

1. **Previous release:** the `build` job gets the tags of all releases. It downloads the archive of the latest release, verifies its `.sha512` and extracts it. It also lists the commit subjects since that tag.
2. **Build:** `pnpm build --previous-archive <folder>` starts from the extracted archive, see [updates](#updates).
3. **Pack:** `pnpm pack:release` decides whether a release is due, writes the root `release.json` into `dist/` and packs the release archive, see [the release archive](#release-archive).
4. **Deploy:** the `deploy` job publishes `dist/` to GitHub Pages.
5. **Release:** the `release` job creates the release, only when one is due.

Without a release yet, step 1 is skipped and the build doesn't get `--previous-archive`: it starts empty.

## Updates

- **Incremental:** each build starts from the previous state of every tool.
- The previous state is the archive of the latest release: the slim `<tool>.json` with the files of each version from `<tool>/<version>.json`. The workflow extracts it and passes it as `--previous-archive <folder>`.
- Without it, like for the first release or with a local `pnpm build`, the build starts empty, like a full refresh. All checksums are computed again, limited by the [download budget](./sources.md#download-budget). It prints which previous state it used.
- Known versions, files and release times are reused. Only missing ones are fetched.
- Versions gone upstream stay listed.
- **Minimum release age:** a new version is only published once its release time is 1 hour old, as a registry can list a release before all its downloads are reachable. Until then it is left out with a notice, and a `latest` which points to it keeps the previous one. Versions without a release time, like the ones of docker, are published right away, and published versions are never taken back.
- Paged sources stop at the first known version. A full refresh fills older gaps.
- **Full refresh:** run the `pages` workflow with the `full` input, or `pnpm build --full`. It ignores the previous state, also when there is a release.

## Failures

- A missing checksum (404) skips the file.
- Other errors warn, the next build retries.
- A tool whose fetch fails republishes its previous data with the old `updatedAt`.
- The build only fails for a tool without any versions.

## Job summary

When `GITHUB_STEP_SUMMARY` is set, as in GitHub Actions, each build appends a summary:

- the build kind and duration
- which tools were updated, kept their previous data or failed
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

- **Previous release:** the pack step gets the extracted archive of the previous release as `--previous`. The tags of all releases are passed as `--published`, and the commit subjects since its tag as `--commits`.
- **When:** a release is due when there is no release yet, or the data changed. A build for a push to `main` only releases when the commits since the previous release have a `feat`, a `fix` or a breaking change (`--release-on code`); it still deploys the site. Data changes and `chore`, `ci`, `docs`, `refactor`, `test` and `build` commits wait for the daily build or a manual run, which release as soon as the data changed (`--release-on any`, the default). The pack step writes `changed` and `version` to the outputs of the job and the `build` job uploads `dist-release/` as the artifact `release`.
- **Release job:** the `release` job runs on `main` after the `build` and `deploy` jobs, so a release always matches the deployed site. It downloads the artifact and runs `gh release create v<version>` for the commit with the notes and the two archive files. It is the only job with `contents: write`.
- **First release:** `1.0.0`.
- **Versions:** the version follows the conventional commits since the previous release, like semantic-release. `--published <tag>` passes the tags of the existing releases, `--commits <file>` the subjects.
  - A `feat` commit is a minor release, like `1.0.1` to `1.1.0`.
  - Anything else is a patch release, also a change of the data only.
  - The major version is the data format major, `releaseMajor` in [`src/release.ts`](../src/release.ts), and only changes with a new format folder, see the [versioning policy](./format.md#versioning-policy).
  - A breaking commit (`type!:` in the subject) of the major version of the latest release can't be released. The pack step doesn't fail, the site is deployed as usual, but it writes no archive and sets the outputs `breaking` and `error`. The `release` job then fails with the message and creates no release.
  - Once the code has a new format major, the breaking commit is released as `<major>.0.0`.
  - The previous release is the highest `v<major>.x.y` tag, tags of other majors and of no version are ignored. The first release of a major is `<major>.0.0`.
- **Data change:** the new files differ from the previous release in other than the `updatedAt` of the files, the digests which follow from it and the `release.json`.
- **`release.json`:** the pack step writes it into the build output before packing, so the deployed site and the archive have the same file. It has the version of the new release, or of the latest release when none is due, and the `updatedAt` of `v1/index.json` as the `buildTime`. A breaking change, which blocks the release, keeps the version of the latest release too.
- **Tags:** a release is tagged `v<version>`, like `v1.0.3`.
- **Release notes:** the header with the version and date, the data changes (versions added and removed per tool, and versions which only gained, lost or changed files, at most 10 listed each, new and removed tools on their own line) and the code changes: the conventional commits since the previous tag (`--commits <file>` has their subjects, one per line), as features, bug fixes, performance improvements, reverts, breaking changes and other (`refactor`, `docs`), each with its pull request number. `chore`, `ci`, `test` and `build` commits aren't listed.

## Regenerate the notes of a release

`pnpm release-notes` writes the notes from two extracted release archives, without a build or network:

```bash
pnpm release-notes --previous <folder> --next <folder> --version 1.0.1 --date 2026-10-16 \
  [--commits <file>] [--out <file>]
```

It prints the markdown, or writes it to `--out`. Use `gh release edit v<version> --notes-file <file>` to replace the notes of a release.

## Environment

- `GITHUB_TOKEN` avoids the GitHub rate limit.
- `TOOL_VERSIONS_DOWNLOAD_BUDGET` sets the download budget, see [sources](./sources.md#download-budget).
