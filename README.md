# containerbase tool versions

The versions containerbase's `install-tool` can install, with the download url and checksum of each file.
A workflow builds them nightly from the upstream sources and publishes them on GitHub Pages.

## Which file to read

1. [`index.json`](https://containerbase.github.io/tool-versions/index.json): the formats. Use `v1/`.
2. `v1/<tool>.json`: the versions of a tool, like [`v1/node.json`](https://containerbase.github.io/tool-versions/v1/node.json).
3. `v1/<tool>/<version>.json`: the download urls and checksums of one version.
4. `v1/<tool>.integrity.json`: the digests to verify them.

`v1/python.json`:

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/v1/tool.schema.json",
  "tool": "python",
  "minVersion": "2.7.18",
  "source": {
    "datasource": "github-releases",
    "packageName": "containerbase/python-prebuild",
    "versioning": "python"
  },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [{ "version": "3.14.8", "releaseTimestamp": "2026-10-02T01:30:20.000Z" }]
}
```

## Docs

- [Format](./docs/format.md): the files, fields, schemas and versioning policy.
- [Sources](./docs/sources.md): where the versions and files come from, computed checksums.
- [Build](./docs/build.md): updates, failures, the job summary and the release trigger.

## Development

`mise install` installs Node.js, pnpm and jactionlint (or use `pnpm install` without [mise](https://mise.jdx.dev)).

```bash
pnpm lint         # pnpm lint-fix to fix
pnpm test
jactionlint       # the GitHub workflows
pnpm build        # writes dist/, --previous-archive <folder> starts from a release, --full skips the previous state
pnpm pack:release # packs the release archive from dist/ into dist-release/
```
