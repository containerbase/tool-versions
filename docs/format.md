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
| `<tool>.full.json`      | `<tool>.json` with the files of all versions, internal        | the next build only              | `tool.schema.json`      |

- Every file has its schema url as the first property, `$schema`.
- The file name of a version is the raw version, so `java/25.0.4+101.0.LTS.json` has a literal `+`. Request it url encoded (`%2B`).
- Versions with characters other than `[0-9A-Za-z.+_-]` are left out.
- Tools with a `type` (installed by a package manager) have no files.

## Fields

Optional fields are omitted when unknown.

| Field                          | Type                          | Meaning                                                                                                     |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `tool`                         | string                        | the tool name                                                                                               |
| `type`                         | `dotnet`, `gem`, `npm`, `pip` | the package manager which installs the tool, from `@containerbase/base`                                     |
| `sourceUrl`                    | url                           | where the source code lives, for changelogs                                                                 |
| `homepage`                     | url                           | the homepage                                                                                                |
| `minVersion`                   | string                        | the oldest supported version on the `defaultDistro`, in the versioning of the tool                          |
| `distroMinVersion`             | map of codename to version    | the oldest version on a distro, only where it differs from `minVersion`. Any codename can be a key          |
| `source`                       | object                        | `datasource`, `packageName` and the [Renovate versioning](https://docs.renovatebot.com/modules/versioning/) |
| `updatedAt`                    | UTC time                      | when the build ran                                                                                          |
| `versions`                     | list                          | the versions, newest first, prereleases included                                                            |
| `versions[].version`           | string                        | the exact `install-tool` version                                                                            |
| `versions[].prerelease`, `lts` | `true`                        | only present when true                                                                                      |
| `versions[].releaseTimestamp`  | UTC time                      | when the version was released, for Renovate's `minimumReleaseAge`                                           |
| `files`                        | list                          | the files of a version, sorted by name, only in the full and per-version files                              |
| `files[].name`                 | string                        | the file name                                                                                               |
| `files[].url`                  | https url                     | where to download it                                                                                        |
| `files[].checksum`             | string                        | `sha256:`, `sha512:` or `sha1:` and the lowercase hex digest                                                |
| `files[].arch`                 | `amd64`, `arm64`              | the architecture, omitted for files which work on every one                                                 |
| `files[].distro`               | string                        | the distro codename, for distro specific files                                                              |

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
  "versions": [{ "version": "3.14.8", "releaseTimestamp": "2026-10-02T01:30:20.000Z" }]
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

- The archive has the root `index.json`, `formats.schema.json` and the `v1/` folder, with the same paths as on the site. It has no `<tool>.full.json` files.
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
