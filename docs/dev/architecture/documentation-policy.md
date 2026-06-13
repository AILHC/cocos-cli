# Documentation Policy

## Stable Documents

`architecture/` and `modules/` describe current architecture. They should not read like investigation logs.

## Evidence Documents

`facts/` contains reproducible facts: source references, generated files, command output, and observed behavior.

## Superpowers Specs And Plans

Formal Superpowers specs are stored in `docs/superpowers/specs/`. Formal Superpowers implementation plans are stored in `docs/superpowers/plans/`.

Do not create new formal plans or specs under `docs/dev/**/plans/` or topic-specific folders. Existing topic plans under `docs/dev/**/plans/` are legacy process records unless explicitly migrated.

## Process Documents

`facts/`, `acceptance/`, `handoff`, and `archive/` preserve context for a specific work period. They can be verbose and date-based.

## End-of-Task Rule

When a task finishes, update stable module or architecture docs with the final conclusion. Keep links to evidence and process docs instead of copying all details.
