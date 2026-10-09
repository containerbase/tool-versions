# containerbase tool versions

Lists the versions containerbase's `install-tool` can install, one file per tool, published on GitHub Pages.
A scheduled workflow fetches them daily from the same upstream sources the containerbase CLI uses, so the generated files are never committed.

## Files

- `https://containerbase.github.io/tool-versions/<tool>.json`: the versions of one tool, e.g. [`node.json`](https://containerbase.github.io/tool-versions/node.json)
- `https://containerbase.github.io/tool-versions/index.json`: every published tool with its file name and version count
- `https://containerbase.github.io/tool-versions/tool.schema.json` and `index.schema.json`: the JSON schemas of those files
- `<file>.sha512` next to each of these files, e.g. `node.json.sha512`: its SHA-512 digest as `<hex>  <file name>`, the format `sha512sum` prints, so a download can be verified

A tool file looks like this:

```json
{
  "tool": "node",
  "source": { "datasource": "node-version", "packageName": "node" },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [
    { "version": "25.0.0" },
    { "version": "25.0.0-rc.1", "prerelease": true },
    { "version": "24.21.0", "lts": true }
  ]
}
```

A tool with prebuild release files, like `python`, lists their checksums:

```json
{
  "version": "3.14.8",
  "checksums": {
    "python-3.14.8-jammy-x86_64.tar.xz": "sha512:ab12…"
  }
}
```

- `versions` is sorted newest first and includes prereleases.
- `version` is in exactly the format `install-tool` accepts, e.g. `25.0.2+10.0.LTS` for `java`.
- `prerelease` and `lts` are only present when they are `true`.
- `checksums` maps a release file name to its `<algorithm>:<hex>` digest, currently always `sha512`.
  It is only present when checksums are known.
  They come from the `<file>.sha512` file next to a release file, so only `github-releases` tools have them.

## Tools

| Tool     | Datasource        | Package                         |
| -------- | ----------------- | ------------------------------- |
| `helm`   | `github-releases` | `helm/helm`                     |
| `java`   | `java-version`    | `java-jdk` (Adoptium, x64, GA)  |
| `node`   | `node-version`    | `node` (nodejs.org)             |
| `pnpm`   | `npm`             | `pnpm`                          |
| `poetry` | `pypi`            | `poetry`                        |
| `python` | `github-releases` | `containerbase/python-prebuild` |

To add a tool, map it in [`src/tools.ts`](./src/tools.ts).
It must exist in the `tools.json` of [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base), else the build fails.
A new kind of source needs a fetcher in [`src/datasources`](./src/datasources).
Add its maintained release lines to [`renovate.Dockerfile`](./renovate.Dockerfile) too.

## Updates

Each build starts from the published files:

- **Incremental:** the versions of the previous file are merged with the fresh ones, so a version that disappears upstream stays listed.
  Where a version is in both, the fresh flags win.
  Paged sources (`github-releases`, `java-version`) list the newest versions first and stop paging after the first page with a known version.
  Checksums of the previous file are reused and never downloaded again; only release files without a checksum get their `.sha512` file downloaded, so files uploaded after an earlier build are filled in later.
  A version counts as known for paging whether or not it has checksums, so older versions on pages that are no longer fetched are only filled by a full refresh.
  A failed `.sha512` download only skips that checksum with a warning, the next build tries again.
- **Fallback:** when fetching a tool fails, its previous file is published again with its old `updatedAt`, so you can see it is stale, and the build logs a warning.
  The build only fails for a tool that has neither fresh nor previous versions, and then nothing is deployed.
- **Full refresh:** run the `pages` workflow manually with the `full` input to skip the previous files and fetch every version again.
- **Release trigger:** [`renovate.Dockerfile`](./renovate.Dockerfile) lists the maintained release lines of each tool.
  There is one line per major, and Renovate updates it on a minor or patch release; Python has one line per minor, updated on patch releases.
  The automerged update on `main` publishes the new version right away.
  New lines are picked up by the nightly run; add them to the file when they are released.

A missing, unreadable or invalid previous file counts as no previous file, as does a file of another source.

## Development

Node.js, pnpm and jactionlint are pinned in [`mise.toml`](./mise.toml), so [`mise`](https://mise.jdx.dev) installs them and the dependencies with `mise install`.
Without mise, install the dependencies with `pnpm install`.

```bash
mise install
pnpm lint
pnpm test
jactionlint
```

- `pnpm lint-fix` fixes the formatting and the fixable lint findings.
- `jactionlint` checks the GitHub workflows.

`pnpm build` fetches all tools and writes the files to `dist/`, `pnpm build --full` skips the previous files.

- `GITHUB_TOKEN` makes authenticated GitHub API requests, which avoids the rate limit.
- `TOOL_VERSIONS_URL` sets where the previous files are downloaded from, by default `https://containerbase.github.io/tool-versions`.
