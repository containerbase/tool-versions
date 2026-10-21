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

`mise install` installs Node.js, pnpm, jactionlint, shellcheck and zizmor, then `pnpm install --frozen-lockfile` installs the dependencies (without [mise](https://mise.jdx.dev), install Node.js and pnpm yourself).

```bash
pnpm lint         # pnpm lint-fix to fix
pnpm test
jactionlint       # the GitHub workflows
zizmor .github/   # security audit of the GitHub workflows
pnpm build        # writes dist/, starts empty, --previous-archive <folder> starts from a release
pnpm pack:release # packs the release archive from dist/ into dist-release/
```

`pnpm build` without `--previous-archive` starts empty, so it computes all checksums again, limited by the download budget.
To start from the latest release, like the nightly build, download and extract it first:

```bash
gh release download --repo containerbase/tool-versions --pattern 'tool-versions-*.tar.xz' --dir tmp
mkdir -p tmp/previous && tar -xJf tmp/tool-versions-*.tar.xz -C tmp/previous
pnpm build --previous-archive tmp/previous
```

`--full` ignores the previous state also with an archive.
