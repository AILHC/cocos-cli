# BUILD-ISSUE-023 Importer Parity Blockers

## Source

- Diff source: `docs/dev/build/facts/asset-db-shared-cache-diff-analysis-20260622.md`
- Project: `E:\own_space\engines\cocos-test-projects`
- Engine: `D:\workspace\engines\cocos\3.8.6`

## Blocking `.assets-data.json` differences

| importer | diff 总数 | versionCode diff | value diff | Editor versionCode | CLI versionCode | shared output default status |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `gltf` | 292 | 292 | 0 | `1` | `3` | blocked until Editor effective versionCode is verified and CLI parity is implemented |
| `scene` | 273 | 273 | 273 | `1` | `2` | blocked until versionCode and `depends` value parity are implemented |
| `prefab` | 67 | 67 | 0 | `1` | `2` | blocked with scene importer parity |
| `fbx` | 50 | 50 | 0 | `1` | `3` | blocked until 3D importer parity is implemented |
| `animation-clip` | 19 | 19 | 0 | `1` | `2` | blocked until animation importer parity is implemented |
| `audio-clip` | 11 | 0 | 11 | `1` | `1` | blocked until value diff is classified |
| `spine-data` | 2 | 0 | 2 | `1` | `1` | blocked until value diff is classified |
| `video-clip` | 1 | 0 | 1 | `1` | `1` | blocked until value diff is classified |

## Decision

Shared project `library` output must remain behind `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` until this blocker list is either fixed or each remaining diff is explicitly accepted with a source-backed reason.
