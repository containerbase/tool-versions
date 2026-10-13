# containerbase tool versions

The versions containerbase's `install-tool` can install, one JSON file per tool on GitHub Pages, with the download url and checksum of each file.
A workflow builds them nightly from the upstream sources the containerbase CLI uses.

## Files

The files of a tool are split, as the full ones are too big to fetch for each use:

- [`<tool>.json`](https://containerbase.github.io/tool-versions/node.json): the versions of one tool, without their `files`. Renovate's datasource and the containerbase CLI's version resolution read it.
- `<tool>/<version>.json`: the `files` of one version, `{ tool, version, files }`, for every version which has files, so not for the package manager tools. The containerbase CLI reads it to install. The file name is the raw version, so `java/25.0.4+101.0.LTS.json` has a literal `+`: request it url encoded (`%2B`), GitHub Pages decodes the path. Versions which contain other characters than `[0-9A-Za-z.+_-]` are left out with a warning.
- `<tool>.integrity.json`: the integrity of each `<tool>/<version>.json`, `{ tool, versions: { "<version>": "sha256-…" } }`, only for tools with files. The containerbase CLI reads it to verify a per-version file.
- [`index.json`](https://containerbase.github.io/tool-versions/index.json): all tools with their `versionCount`, `slim` (`<tool>.json`) and, for tools with files, `versionFiles` (`<tool>.integrity.json`), each as `{ file, integrity }`, so clients don't hard-code the names.
- `<tool>.full.json`: internal, the same as `<tool>.json` with the `files` of all versions. Only the next build reads it, as the previous state to start from, so it isn't in the index; clients read the files above instead.
- `tool.schema.json` (for `<tool>.json` and `<tool>.full.json`), `version.schema.json` (for `<tool>/<version>.json`), `integrity.schema.json` (for `<tool>.integrity.json`), `index.schema.json`: the JSON schemas

`<tool>.json` (the `files` are in `python/3.14.8.json` and `python.full.json`):

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
  "versions": [{ "version": "3.14.8", "releaseTimestamp": "2026-10-02T01:30:20.000Z" }]
}
```

`python/3.14.8.json`, and the `files` of the version in `python.full.json`:

```json
{
  "tool": "python",
  "version": "3.14.8",
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
```

- `source`: the datasource, package and [Renovate versioning](https://docs.renovatebot.com/modules/versioning/) of the versions.
- `type`: the package manager installing the tool (`dotnet`, `gem`, `npm` or `pip`, from [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base)). These tools have no files, the package manager installs and verifies them.
- `sourceUrl`, `homepage`: links for Renovate's changelogs.
- `versions`: newest first, including prereleases, only installable ones (with an `amd64` file or a file for any architecture, unless the tool has a `type`; `arm64` files are added when they exist). `version` is the exact `install-tool` version.
- `prerelease`, `lts`: only present when `true`.
- `releaseTimestamp`: the release time in UTC, for Renovate's `minimumReleaseAge`.
- `files` (in the full and the per-version files only): sorted by name, each with the https `url`, `checksum` (`sha256:` or `sha512:` lowercase hex), and `arch` (`amd64`/`arm64`) and `distro` where they apply.

Optional fields are omitted when unknown.

### Integrity

The client files form a hash chain: `index.json` has the `integrity` of each `<tool>.json` and `<tool>.integrity.json`, and `<tool>.integrity.json` the integrity of each `<tool>/<version>.json`. The digests are kept out of `<tool>.json`, so the version list stays small for Renovate and the version resolution, and only the install fetches them. An integrity is the SRI-style sha256 digest of the file's exact published bytes, like npm's `integrity` (`sha256-<base64>`). Verifying a file against its parent catches corruption, truncation, and files of different deploys mixed by a running deploy or a stale cache: on a mismatch, fetch `index.json` again and retry once.

The chain doesn't prove who published the files, `index.json` changes with every build, so it can't be pinned. Trust comes from HTTPS and GitHub Pages, like for the upstream checksums. A signature of `index.json` would add authenticity later.

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

`rust`, `dart`, `ghc` and `cabal` are downloaded from other hosts too: `rust` takes its versions from the releases of `rust-lang/rust` and the `.tar.xz` archives (`.tar.gz` before 1.19.0) and `.sha256` files from static.rust-lang.org. `dart` lists the stable release folders of the `dart-archive` bucket and reads the `.sha256sum` of each sdk zip (versions below 2 are skipped, the installer doesn't support them). `ghc` and `cabal` list the folders of downloads.haskell.org and read the `SHA256SUMS` of each release for the static `deb10` build (`linux-unknown` for cabal 3.18 and later). `java-jdk` and `java-jre` use the Adoptium source of `java`, with the jdk or jre image type. `android-sdk-cmdline-tools` isn't published yet, its versions come from a large repository XML.

The package manager tools (`bundler`, `checkov`, `cocoapods`, `conan`, `copier`, `corepack`, `hashin`, `kas`, `npm`, `paket`, `pdm`, `pip-tools`, `pipenv`, `pnpm`, `poetry`, `renovate`, `uv`, `yarn`, `yarn-slim`) come from npm, pypi, rubygems or nuget without files; the deprecated `bower` and `lerna` aren't published. `yarn` is published as the union of the `yarn` package (1.x) and `@yarnpkg/cli-dist` (2 and later), its `source.packageName` is `@yarnpkg/cli-dist`; `yarn-slim` only has the 1.x versions of `yarn`. `paket` has no release times, nuget.org only lists them page by page.

## Updates

- **Incremental:** each build starts from the published `<tool>.full.json` files (as the Pages deploy replaces the whole site, the per-version files can't be fetched again). Known versions, files and release times are reused, only missing ones are fetched, and versions gone upstream stay listed. Paged sources stop at the first known version, so older gaps are filled by a full refresh.
- **Failures:** a missing checksum (404) skips the file, other errors warn and the next build retries. A tool whose fetch fails republishes its previous file with the old `updatedAt`; the build only fails for a tool without any versions.
- **Full refresh:** run the `pages` workflow with the `full` input.
- **Release trigger:** Renovate updates [`renovate.Dockerfile`](./renovate.Dockerfile), one line per maintained major (per minor for golang, kubectl, php, python and ruby), and the automerged update publishes a release right away; GitHub releases wait until they are 2 hours old, when all their assets are uploaded (other datasources, like docker, have no release times to wait for). Add new lines when they are released.

## Development

`mise install` installs Node.js, pnpm, jactionlint and the dependencies (or `pnpm install` without [mise](https://mise.jdx.dev)).

```bash
pnpm lint         # pnpm lint-fix to fix
pnpm test
jactionlint       # the GitHub workflows
pnpm build        # writes dist/, --full skips the previous files
```

`GITHUB_TOKEN` avoids the GitHub rate limit, `TOOL_VERSIONS_URL` overrides where the previous files come from.
