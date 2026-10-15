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

## Environment

- `GITHUB_TOKEN` avoids the GitHub rate limit.
- `TOOL_VERSIONS_URL` overrides where the previous files come from.
- `TOOL_VERSIONS_DOWNLOAD_BUDGET` sets the download budget, see [sources](./sources.md#download-budget).
