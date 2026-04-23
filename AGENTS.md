# AGENTS.md

## Project overview

A **uv workspace** for validating GWAS summary statistics (Gene-based, CNV) before submission to the [GWAS Catalog](https://ebi.ac.uk/gwas). Two packages share the `gwascatalog` namespace:

- **`sumstatlib`** (`sumstatlib/`) — Pydantic v2 validation library. The canonical data models live here.
- **`sumstatapp`** (`src/gwascatalog/sumstatapp/`) - contains two applications:
  - A CLI for batch processing (`sumstatapp/cli/`), built using only the standard library (argparse), communicating with `sumstatlib` via direct imports
  - A web-based version of the same wizard (`sumstatapp/web/`), built with Tailwind CSS and vanilla JS, communicating with `sumstatlib` via WebAssembly (Pyodide)

The application is a scientific workflow for:

1) validating user data and highlighting errors with clear messages and actionable guidance, and
2) simplifying submission to the GWAS Catalog by generating a compliant summary statistics file and checksums

Input data will regularly contain up to tens of millions of rows. Assume streaming or chunked processing may be required (700MB - 1GB input files are typical). The web app must run entirely in the browser, so memory usage is a critical concern.

Failing fast is good, but the user should be able to review a batch of errors in one go, not just the first one encountered. Consider a design where validation errors are collected and displayed in a scrollable panel for user review.

## Runtime assumptions

- Python 3.12+
- Pydantic v2
- Workspace managed with `uv`
- Linting enforced by `ruff`
- Type checking enforced by `ty`
- Test runner: `pytest` via `nox`

`nox` serves as an entrypoint for all CI/CD actions.

## Repository layout

```
sumstatlib/                  # validation library (canonical pydantic data models)
src/gwascatalog/sumstatapp/  # validation applications
  cli/                       # CLI interface (argparse only)
  web/                       # browser UI (HTML + JS + Pyodide)

docs                         # documentation site (Docusaurus)
docs/docs/decisions/         # architecture decision records
```

## Out of scope

SNP validation is NOT implemented in this repository.

Users are directed to `gwas-sumstats-tools`.

The `snp` module is a placeholder and must not be modified or expanded.

## Key rules for agents

- Models must be created using `Model.model_validate(..., context={...})`
- Domain constraints belong in `Annotated` types
- Do NOT introduce imperative validators
- Input files may be 700MB–1GB; be cautious when loading entire datasets into memory
- Never add new dependencies or frameworks
- Always import from pydantic via the `_pydantic.py` shim

## Package responsibilities

### sumstatlib

Responsible for:

- Data models
- Structural validation
- Domain types
- Summary statistic file parsing and validation

Must NOT:

- Depend on CLI or web modules
- Perform UI formatting

### sumstatapp

Responsible for:

- User interfaces
- Error presentation

### docs

Responsible for:

- Documentation for users that want to submit data (high level, task-focused)
- Documentation for users that want to reuse data (low level, understanding-focused)
- Bundling the web application in sumstatapp at build time

## Error handling

Library (`sumstatlib`):

- Raise `ValueError` for validation failures.
- Pydantic converts these to `ValidationError`.

Applications (`sumstatapp`):

- Catch `ValidationError`
- Aggregate errors
- Display them to the user.

Applications must NOT catch unexpected exceptions.

Unexpected errors should crash the application.

## Architecture decisions

Read `docs/docs/decisions/` for rationale. Key points:

- **"Parse, don't validate"**: domain constraints are encoded in `Annotated` types (`sumstat_types.py`), not imperative validators. Reuse types from `core/sumstat_types.py` before creating new ones.
- **Validation context**: models require `Model.model_validate(data, context={...})` — never direct instantiation. Context carries runtime metadata (e.g. `assembly`, `allow_zero_pvalues`, `primary_effect_size`).
- **Structural vs semantic validation**: Pydantic handles structure. `validate_semantics()` is an abstract hook for domain checks (may intentionally be unimplemented).
- **Private attributes** (`PrivateAttr`) store runtime context (e.g. `_assembly`) to keep the data model clean.
- Concrete models are marked `@final` to prevent deep hierarchies.

## Code conventions

- Use `typing.Annotated` with `pydantic.Field` for type definitions, not bare types
- Use `match`/`case` for multi-branch validation logic (Python 3.12+)
- Enums inherit from `StrEnum`
- Use `pathlib` (not `os.path`) — enforced by ruff rule `PTH`
- Types used only for annotations go in `TYPE_CHECKING` blocks — enforced by ruff rule `TC`
- Prefer absolute imports; strictly avoid circular imports

## Testing patterns

- Minimum 90% coverage enforced by CI.
- Integration tests are excluded from coverage.
- Focus tests on `sumstatlib` core validation logic.

When adding features:

- Add unit tests for all new validation logic.
- Use fixtures and mocks to isolate components.

## Build & run

```shell
uv sync # install workspace dependencies
nox -s tests # run tests
nox -s lint # lint

## Completion criteria

Before a task is finished, you must run the lint and tests nox sessions successfully.

Also, always make sure the docs can build:

cd docs && npm run build

## User persona for validation applications

- A senior researcher or clinician who is a specialist in their disease/trait
- They understand the data well, but have limited CLI skills and no time or motivation to learn - they had a bioinformatician do the analysis for them.
- They now want to share the data, but the bioinformatician is unavailable to help make the submission.
- These users may be uncomfortable using a terminal and would prefer a web-based interface.

Consider the user journey and how to make it as smooth as possible for this persona. The app should guide them through the process with clear instructions, helpful error messages, and a simple interface that doesn't require technical expertise.

## When in doubt

- Prefer to modify or reuse existing types rather than create new ones
- Never introduce imperative validators unless explicitly instructed
- Do not refactor directory structure
- Do not introduce APIs deprecated in Pydantic v2
- Avoid loading entire datasets into memory unless explicitly required
