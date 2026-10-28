# Format

The reference for consumers of the published files.
All urls are relative to `https://containerbase.github.io/tool-versions/`.

## Root index

[`index.json`](https://containerbase.github.io/tool-versions/index.json) lists the published formats.
Pin a major version of the format and read the root index only to warn when it is deprecated.

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/formats.schema.json",
  "defaultDistro": "noble",
  "formats": [{ "version": 1, "path": "v1/", "status": "current" }]
}
```

- `defaultDistro`: the codename of the Ubuntu release the default containerbase image is built from, from `@containerbase/base`. The `minVersion` of the tools refers to it.
- `formats[].status`: `current`, `preview` or `deprecated`.
- `formats[].removalDate`: when a deprecated format is removed, only for those.
- Schema: `formats.schema.json`.

Everything else is in the folder of a format, `v1/` for now.

## Files

The paths are relative to the folder of the format, like `v1/`.

| File                    | Content                                                       | Read by                          | Schema                  |
| ----------------------- | ------------------------------------------------------------- | -------------------------------- | ----------------------- |
| `index.json`            | all tools, with the file names and integrity of their files   | clients, to find the other files | `index.schema.json`     |
| `<tool>.json`           | the versions of a tool, without their files                   | Renovate, version resolution     | `tool.schema.json`      |
| `<tool>/<version>.json` | the files of one version, only for tools with files           | the install                      | `version.schema.json`   |
| `<tool>.integrity.json` | the integrity of each `<tool>/<version>.json`, same condition | the install                      | `integrity.schema.json` |

- Every file has its schema url as the first property, `$schema`.
- The file name of a version is the raw version, so `java/25.0.4+101.0.LTS.json` has a literal `+`. Request it url encoded (`%2B`).
- Versions with characters other than `[0-9A-Za-z.+_-]` are left out.
- Tools with a `type` (installed by a package manager) have no files.

## Fields

Optional fields are omitted when unknown.

| Field                          | Type                          | Meaning                                                                                            |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `tool`                         | string                        | the tool name                                                                                      |
| `type`                         | `dotnet`, `gem`, `npm`, `pip` | the package manager which installs the tool, from `@containerbase/base`                            |
| `sourceUrl`                    | url                           | where the source code lives, for changelogs                                                        |
| `homepage`                     | url                           | the homepage                                                                                       |
| `lts`                          | `true`                        | the tool has LTS release streams, like `node` and `java`, only present when true                   |
| `minVersion`                   | string                        | the oldest supported version on the `defaultDistro`, in the versioning of the tool                 |
| `distroMinVersion`             | map of codename to version    | the oldest version on a distro, only where it differs from `minVersion`. Any codename can be a key |
| `minCb`                        | list of `version` and `cb`    | the oldest containerbase version which can install a version and the ones above it, see below      |
| `source`                       | object                        | deprecated build information, don't use it, see below                                              |
| `updatedAt`                    | UTC time                      | when the build ran                                                                                 |
| `versions`                     | list                          | the versions, newest first, prereleases included                                                   |
| `versions[].version`           | string                        | the exact `install-tool` version                                                                   |
| `versions[].prerelease`, `lts` | `true`                        | only present when true                                                                             |
| `versions[].releaseTimestamp`  | UTC time                      | when the version was released, for Renovate's `minimumReleaseAge`                                  |
| `versions[].constraints`       | map of tool to constraint     | the runtime the version needs, keyed by the parent tool, see below                                 |
| `versions[].archs`             | list of `amd64`, `arm64`      | the archs with a file of the version, sorted, only in `<tool>.json`, see below                     |
| `versions[].distros`           | list of codenames             | the distros with a file of the version, sorted, only in `<tool>.json`, see below                   |
| `files`                        | list                          | the files of a version, sorted by name, only in the per-version files                              |
| `files[].name`                 | string                        | the file name                                                                                      |
| `files[].url`                  | https url                     | where to download it                                                                               |
| `files[].checksum`             | string                        | `sha256:`, `sha512:` or `sha1:` and the lowercase hex digest                                       |
| `files[].arch`                 | `amd64`, `arm64`              | the architecture, omitted for files which work on every one                                        |
| `files[].distro`               | string                        | the distro codename, for distro specific files                                                     |

`source` (`datasource`, `packageName`, `versioning`) is deprecated.
It describes how the build fetches the versions, readers must not rely on it.
It is removed with the next format major ([#146](https://github.com/containerbase/tool-versions/issues/146)).

`versions[].constraints` is only present when the registry has a constraint for the version:

- Constraints don't change once published, the registry is only read for versions without one.
- It is keyed by the parent tool, like `node`, `python` or `ruby`, and the value is the raw constraint in the syntax of the registry.
  Evaluate it with the versioning of the parent tool, like Renovate does.
- Tools from npm have `engines.node` as the `node` constraint, not `devEngines`.
- Tools from PyPI have `requires_python` as the `python` constraint.
  It is the first one of the files which are not yanked.
- Tools from RubyGems have `required_ruby_version` as the `ruby` constraint, unless it accepts any ruby (`>= 0`).

`minCb` is only present for tools with releases which an older containerbase can't install, like a new version scheme.
Each entry is a `version` and the oldest containerbase version `cb` which can install it:

- The range of an entry starts at its `version`: it applies to that version and to every version listed above it, as `versions` is sorted newest first.
  Readers only need the list positions, not the versioning of the tool.
- Readers skip the versions of an entry whose `cb` is above their containerbase version.
  `dev` builds of containerbase don't filter.
- Readers which don't know the field ignore it.

`versions[].archs` and `versions[].distros` list the `files[].arch` and `files[].distro` of the version, so a version can be resolved without its files:

- `archs` is omitted for tools with a `type`, which have no files, and for versions whose files all work on every architecture.
- `distros` is omitted for tools with a `type` and for versions without distro specific files.
- To pick a version for a host, check that it is listed (so at least `minVersion`), at least the `distroMinVersion` of the host distro, and has the host arch and distro in `archs` and `distros`, or the field is missing.
  This skips a release whose `arm64` build is still missing, for example.

Which versions are listed:

- Only versions with an `amd64` file or a file for any architecture, unless the tool has a `type`.
- Not the versions below `minVersion`.
- Not the files of a distro for versions below its `distroMinVersion`.

## Examples

`v1/python.json`, the files are in `v1/python/3.14.8.json`:

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/v1/tool.schema.json",
  "tool": "python",
  "sourceUrl": "https://github.com/python/cpython",
  "homepage": "https://www.python.org",
  "minVersion": "2.7.18",
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
      "archs": ["amd64"],
      "distros": ["jammy"]
    }
  ]
}
```

`v1/npm.json`, a tool with constraints:

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/v1/tool.schema.json",
  "tool": "npm",
  "type": "npm",
  "source": { "datasource": "npm", "packageName": "npm", "versioning": "npm" },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [
    {
      "version": "12.0.0",
      "releaseTimestamp": "2026-09-30T10:00:00.000Z",
      "constraints": { "node": "^20.17.0 || >=22.9.0" }
    }
  ]
}
```

`v1/python/3.14.8.json`:

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/v1/version.schema.json",
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

## Release archive

The client files are also attached to each GitHub release as `tool-versions-<version>.tar.xz`, with `tool-versions-<version>.tar.xz.sha512`.

- The archive has the root `index.json`, `formats.schema.json` and the `v1/` folder, with the same paths as on the site.
- The next build starts from it: the `files` of a version are in its `<tool>/<version>.json`.
- The `.sha512` file has the lowercase hex digest of the archive, like the ones of the containerbase prebuilds.
- It is meant for embedding the data, like in the containerbase image.
- The site stays the primary source, it is always the latest data.

How the releases are made is in [the build docs](./build.md#release-archive).

## Versioning policy

- A breaking change is published in a new folder, like `v2/`, and listed in the root index.
- Breaking means renaming or removing a field, or changing its meaning.
- The old folder keeps being published for a while, as `deprecated` with a `removalDate`.
- Adding optional fields is not breaking.

## Integrity

The client files form a hash chain:

- `index.json` has the integrity of each `<tool>.json` and `<tool>.integrity.json`.
- `<tool>.integrity.json` has the integrity of each `<tool>/<version>.json`.
- The digests are not in `<tool>.json`, so the version list stays small.

An integrity is the SRI-style sha256 digest of the exact published bytes, like npm's: `sha256-<base64>`.
It includes the `$schema`.
On a mismatch, fetch `index.json` again and retry once.
A mismatch can come from corruption, truncation, or files of different deploys mixed by a stale cache.

The chain doesn't prove who published the files, as `index.json` changes with every build.
Trust comes from HTTPS and GitHub Pages.
