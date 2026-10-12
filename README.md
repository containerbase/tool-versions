# containerbase tool versions

The versions containerbase's `install-tool` can install, one JSON file per tool on GitHub Pages, with the download url and checksum of each file.
A workflow builds them nightly from the upstream sources the containerbase CLI uses.

## Files

- [`<tool>.json`](https://containerbase.github.io/tool-versions/node.json): the versions of one tool
- [`index.json`](https://containerbase.github.io/tool-versions/index.json): all tools with their file and version count
- `tool.schema.json`, `index.schema.json`: the JSON schemas
- `<file>.sha512` next to each file, in `sha512sum` format

```json
{
  "tool": "python",
  "sourceUrl": "https://github.com/python/cpython",
  "homepage": "https://www.python.org",
  "source": {
    "datasource": "github-releases",
    "packageName": "containerbase/python-prebuild",
    "versioning": "python"
  },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [
    {
      "version": "3.14.8",
      "releaseTimestamp": "2026-10-02T01:30:20.000Z",
      "files": [
        {
          "name": "python-3.14.8-jammy-x86_64.tar.xz",
          "url": "https://github.com/containerbase/python-prebuild/releases/download/3.14.8/python-3.14.8-jammy-x86_64.tar.xz",
          "checksum": "sha512:6976…",
          "arch": "amd64",
          "distro": "jammy"
        }
      ]
    }
  ]
}
```

- `source`: the datasource, package and [Renovate versioning](https://docs.renovatebot.com/modules/versioning/) of the versions.
- `type`: the package manager installing the tool (`dotnet`, `gem`, `npm` or `pip`, from [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base)). These tools have no files, the package manager installs and verifies them.
- `sourceUrl`, `homepage`: links for Renovate's changelogs.
- `versions`: newest first, including prereleases, only installable ones (with an `amd64` file or a file for any architecture, unless the tool has a `type`; `arm64` files are added when they exist). `version` is the exact `install-tool` version.
- `prerelease`, `lts`: only present when `true`.
- `releaseTimestamp`: the release time in UTC, for Renovate's `minimumReleaseAge`.
- `files`: sorted by name, each with the https `url`, `checksum` (`sha256:` or `sha512:` lowercase hex), and `arch` (`amd64`/`arm64`) and `distro` where they apply.

Optional fields are omitted when unknown.

## Tools

The tools and their sources are mapped in [`src/tools.ts`](./src/tools.ts), each must exist in `@containerbase/base`.

| Tool     | Versions                                        | Files                                                             |
| -------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `helm`   | GitHub releases `helm/helm`                     | get.helm.sh archives, sha256 from `.sha256sum` (older: `.sha256`) |
| `java`   | Adoptium, JDK, GA                               | Adoptium linux packages, sha256 from the assets api               |
| `node`   | nodejs.org                                      | `.tar.xz` archives, sha256 from `SHASUMS256.txt`                  |
| `python` | GitHub releases `containerbase/python-prebuild` | prebuilds with a `.sha512` file, without `bionic` and `focal`     |

The containerbase prebuilds (`composer`, `erlang`, `flutter`, `golang`, `maven`, `mono`, `nix`, `php`, `ruby`, `skopeo`, `wally`, besides `python`) come from the releases of `containerbase/<tool>-prebuild` like `python`. Their versions are sorted with the Renovate versioning of the tool (`docker` for the four-part `erlang` versions, `maven`, `ruby`, else `semver`). Some prebuilds have no `arch` (`composer`, `maven`) and the `jammy` ones have a `distro`.

The GitHub release tools (`apko`, `apm`, `buf`, `buildx`, `bun`, `deno`, `devbox`, `docker-compose`, `elixir`, `flux`, `gh`, `git-lfs`, `gleam`, `helmfile`, `kustomize`, `mise`, `nub`, `pixi`, `powershell`, `sbt`, `sops`, `tofu`, `vendir`, `vp`) take their versions from the releases of the upstream repository, and their linux `amd64` and `arm64` files from the release assets. The checksum comes from a checksum asset of the release, either a file per asset or a list for all of them, which is downloaded once per release (see `toolFiles` in [`src/tools.ts`](./src/tools.ts)). The tags of `bun` (`bun-v`) and `kustomize` (`kustomize/v`) have a prefix, and the other tags of the `kustomize` repository are skipped. A version without any file with a checksum isn't published.

`kubectl`, `terraform` and `gradle` are downloaded from other hosts. `kubectl` takes its versions from the releases of `kubernetes/kubernetes` and the binaries and `.sha256` files from dl.k8s.io. `terraform` reads releases.hashicorp.com: the `index.json` lists the versions and the linux zips, the `SHA256SUMS` of a release the checksums. `gradle` reads `services.gradle.org/versions/all` (without snapshots, nightlies and broken releases) and the `.sha256` of each `gradle-<version>-bin.zip`.

The package manager tools (`bundler`, `checkov`, `cocoapods`, `conan`, `copier`, `corepack`, `hashin`, `kas`, `npm`, `paket`, `pdm`, `pip-tools`, `pipenv`, `pnpm`, `poetry`, `renovate`, `uv`, `yarn`, `yarn-slim`) come from npm, pypi, rubygems or nuget without files; the deprecated `bower` and `lerna` aren't published. `yarn` is published as the union of the `yarn` package (1.x) and `@yarnpkg/cli-dist` (2 and later), its `source.packageName` is `@yarnpkg/cli-dist`; `yarn-slim` only has the 1.x versions of `yarn`. `paket` has no release times, nuget.org only lists them page by page.

## Updates

- **Incremental:** each build starts from the published files. Known versions, files and release times are reused, only missing ones are fetched, and versions gone upstream stay listed. Paged sources stop at the first known version, so older gaps are filled by a full refresh.
- **Failures:** a missing checksum (404) skips the file, other errors warn and the next build retries. A tool whose fetch fails republishes its previous file with the old `updatedAt`; the build only fails for a tool without any versions.
- **Full refresh:** run the `pages` workflow with the `full` input.
- **Release trigger:** Renovate updates [`renovate.Dockerfile`](./renovate.Dockerfile), one line per maintained major (per minor for golang, kubectl, php, python and ruby), and the automerged update publishes a release once it is 2 hours old, when all its files are uploaded. Add new lines when they are released.

## Development

`mise install` installs Node.js, pnpm, jactionlint and the dependencies (or `pnpm install` without [mise](https://mise.jdx.dev)).

```bash
pnpm lint         # pnpm lint-fix to fix
pnpm test
jactionlint       # the GitHub workflows
pnpm build        # writes dist/, --full skips the previous files
```

`GITHUB_TOKEN` avoids the GitHub rate limit, `TOOL_VERSIONS_URL` overrides where the previous files come from.
