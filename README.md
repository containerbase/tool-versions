# containerbase tool versions

Lists the versions containerbase's `install-tool` can install, one file per tool, published on GitHub Pages.
A scheduled workflow fetches them daily from the same upstream sources the containerbase CLI uses, so the generated files are never committed.

## Files

- `https://containerbase.github.io/tool-versions/<tool>.json`: the versions of one tool, e.g. [`node.json`](https://containerbase.github.io/tool-versions/node.json)
- `https://containerbase.github.io/tool-versions/index.json`: every published tool with its file name and version count
- `https://containerbase.github.io/tool-versions/tool.schema.json` and `index.schema.json`: the JSON schemas of those files

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

- `versions` is sorted newest first and includes prereleases.
- `version` is in exactly the format `install-tool` accepts, e.g. `25.0.2+10.0.LTS` for `java`.
- `prerelease` and `lts` are only present when they are `true`.

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

## Updates

Each build starts from the published files:

- **Incremental:** the versions of the previous file are merged with the fresh ones, so a version that disappears upstream stays listed.
  Where a version is in both, the fresh flags win.
  Paged sources (`github-releases`, `java-version`) list the newest versions first and stop paging after the first page with a known version.
- **Fallback:** when fetching a tool fails, its previous file is published again with its old `updatedAt`, so you can see it is stale, and the build logs a warning.
  The build only fails for a tool that has neither fresh nor previous versions, and then nothing is deployed.
- **Full refresh:** run the `pages` workflow manually with the `full` input to skip the previous files and fetch every version again.

A missing, unreadable or invalid previous file counts as no previous file, as does a file of another source.

## Development

```bash
pnpm install
pnpm lint
pnpm test
```

`pnpm build` fetches all tools and writes the files to `dist/`, `pnpm build --full` skips the previous files.

- `GITHUB_TOKEN` makes authenticated GitHub API requests, which avoids the rate limit.
- `TOOL_VERSIONS_URL` sets where the previous files are downloaded from, by default `https://containerbase.github.io/tool-versions`.
