"""CLI for batch validation of GWAS summary statistics files.

Usage::

    gwascatalog beyondsnp validate INPUT [INPUT ...] --type {CNV,GENE} [OPTIONS]

Accepts a list of files. Run with ``--help`` for the full list of options.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from gwascatalog.sumstatlib import (
    CNVSumstatModel,
    GeneSumstatModel,
    SumstatConfig,
    SumstatTable,
)

from gwascatalog.sumstatapp import __version__

if TYPE_CHECKING:
    from collections.abc import Sequence

    from gwascatalog.sumstatlib import SumstatError

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(module)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


# ── Result type ───────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class FileResult:
    """Outcome of validating a single file."""

    input_path: Path
    output_path: Path | None
    error_path: Path | None
    rows_processed: int
    valid_count: int
    error_count: int
    elapsed_seconds: float
    md5_checksum: str | None
    fatal_error: str | None


# ── Worker ───────────────────────────────────────────────────


def _get_model(variation_type: str) -> type[CNVSumstatModel] | type[GeneSumstatModel]:
    """Return the Pydantic model class for the given variation type."""
    match variation_type:
        case "CNV":
            return CNVSumstatModel
        case "GENE":
            return GeneSumstatModel
        case _:
            raise ValueError(f"Unsupported variation type: {variation_type}")


def _write_error_report(error_path: Path, errors: list[SumstatError]) -> None:
    """Write validation errors to a human-readable TSV file."""
    dict_errors = [dict(e) for e in errors]

    with error_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, delimiter="\t", fieldnames=["row", "column", "msg"])
        writer.writeheader()
        writer.writerows(dict_errors)


def _compute_md5(path: Path) -> str:
    """Compute the MD5 checksum of a file."""
    md5 = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5.update(chunk)
    return md5.hexdigest()


def validate_file(
    input_path: str,
    output_dir: str | Path,
    variation_type: str,
    config: SumstatConfig,
) -> FileResult:
    """Validate a single summary statistics file and write results.

    Returns:
        A :class:`FileResult` summarising the outcome.
    """
    inp = Path(input_path)
    out_dir = Path(output_dir)
    output_path = out_dir / f"validated_{inp.stem}.tsv.gz"
    error_path = out_dir / f"{inp.stem}.errors.tsv"

    if output_path.exists():
        raise FileExistsError(output_path)
    if error_path.exists():
        raise FileExistsError(error_path)

    start = time.monotonic()

    try:
        model = _get_model(variation_type)

        table = SumstatTable(data_model=model, input_path=inp, config=config)

        rows_processed = 0
        valid_count = 0
        writer = table.open_writer(output_path, compress=True)

        for row in writer:
            rows_processed += 1
            if row.is_valid:
                valid_count += 1

        elapsed = time.monotonic() - start

        # ── Validation failed: write error report ────────────────
        if table.has_validation_failed:
            _write_error_report(error_path, table.errors)
            output_path.unlink(missing_ok=True)
            return FileResult(
                input_path=inp,
                output_path=None,
                error_path=error_path,
                rows_processed=rows_processed,
                valid_count=valid_count,
                error_count=len(table.errors),
                elapsed_seconds=round(elapsed, 2),
                md5_checksum=None,
                fatal_error=None,
            )

        # ── Validation passed: compute checksum ──────────────────
        md5: str | None = None
        if output_path.exists():
            md5 = _compute_md5(output_path)
            md5_file = output_path.with_suffix(output_path.suffix + ".md5")
            md5_file.write_text(f"{md5}  {output_path.name}\n", encoding="utf-8")

        return FileResult(
            input_path=inp,
            output_path=output_path,
            error_path=None,
            rows_processed=rows_processed,
            valid_count=valid_count,
            error_count=0,
            elapsed_seconds=round(elapsed, 2),
            md5_checksum=md5,
            fatal_error=None,
        )

    except Exception as exc:  # noqa: BLE001 — report all failures back to the caller
        elapsed = time.monotonic() - start
        logger.debug("Fatal error validating %s", inp.name, exc_info=True)
        return FileResult(
            input_path=inp,
            output_path=None,
            error_path=None,
            rows_processed=0,
            valid_count=0,
            error_count=0,
            elapsed_seconds=round(elapsed, 2),
            md5_checksum=None,
            fatal_error=str(exc),
        )


# ── Input resolution ──────────────────────────────────────────────


def _resolve_inputs(raw: list[str]) -> list[Path]:
    """Turn user-supplied paths into files."""
    resolved: list[Path] = []

    for entry in raw:
        p = Path(entry)
        if p.is_file():
            resolved.append(p.resolve())
        else:
            logger.warning(f"Skipping {entry}: not a file")

    # Deduplicate while preserving order
    seen: set[Path] = set()
    unique: list[Path] = []
    for f in resolved:
        if f not in seen:
            seen.add(f)
            unique.append(f)
    return unique


# ── Argument parsing ──────────────────────────────────────────────


def _add_validate_args(parser: argparse.ArgumentParser) -> None:
    """Register all arguments for the ``validate`` subcommand."""
    parser.add_argument(
        "inputs",
        nargs="+",
        metavar="INPUT",
        help="Files to validate",
    )
    parser.add_argument(
        "--type",
        required=True,
        choices=["CNV", "GENE"],
        dest="variation_type",
        help="Type of genetic variation (CNV or GENE)",
    )
    parser.add_argument(
        "--assembly",
        choices=["GRCh38", "GRCh37", "NCBI36", "NCBI35", "NCBI34"],
        default=None,
        help="Genome assembly (e.g. GRCh38)",
    )
    parser.add_argument(
        "--effect-size",
        choices=["beta", "odds_ratio", "hazard_ratio", "z_score"],
        default=None,
        dest="primary_effect_size",
        help="Primary effect size measure",
    )
    parser.add_argument(
        "--allow-zero-pvalues",
        action="store_true",
        default=False,
        help="Accept zero as a valid p-value",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("validated"),
        help="Output directory for results (default: ./validated/)",
    )
    parser.set_defaults(func=_run_validate)


def _build_parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="gwascatalog",
        description="GWAS Catalog data tools.",
    )
    root.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    root_sub = root.add_subparsers(dest="group", metavar="COMMAND")
    root_sub.required = True

    # ── beyondsnp group ───────────────────────────────────────
    beyondsnp = root_sub.add_parser(
        "beyondsnp",
        help="Tools for gene-based and CNV summary statistics.",
    )
    beyondsnp_sub = beyondsnp.add_subparsers(dest="subcommand", metavar="SUBCOMMAND")
    beyondsnp_sub.required = True

    validate_parser = beyondsnp_sub.add_parser(
        "validate",
        help="Validate summary statistics files for GWAS Catalog submission.",
        description=(
            "Validate GWAS summary statistics files for submission to the GWAS Catalog."
        ),
        epilog=(
            "Example: gwascatalog beyondsnp validate data/file.tsv "
            "--type GENE --assembly GRCh38"
        ),
    )
    _add_validate_args(validate_parser)

    return root


# ── Result display ────────────────────────────────────────────────


def _print_summary(results: list[FileResult]) -> None:
    """Print a human-readable summary to stdout."""
    passed = [r for r in results if r.fatal_error is None and r.error_count == 0]
    failed = [r for r in results if r.fatal_error is None and r.error_count > 0]
    fatal = [r for r in results if r.fatal_error is not None]

    width = 60
    print(f"\n{'=' * width}")
    print(
        f"Validated {len(results)} file(s): "
        f"{len(passed)} passed, {len(failed)} failed, {len(fatal)} error(s)"
    )
    print(f"{'=' * width}")

    for r in passed:
        print(
            f"  PASS  {r.input_path.name}  "
            f"({r.valid_count:,} rows, {r.elapsed_seconds}s)"
        )
        if r.output_path and r.md5_checksum:
            print(f"        -> {r.output_path.name}  [md5: {r.md5_checksum}]")

    for r in failed:
        print(
            f"  FAIL  {r.input_path.name}  "
            f"({r.error_count} error(s), "
            f"{r.valid_count:,}/{r.rows_processed:,} rows valid)"
        )
        if r.error_path:
            print(f"        -> errors: {r.error_path}")

    for r in fatal:
        print(f"  ERROR {r.input_path.name}: {r.fatal_error}")


# ── Subcommand handlers ───────────────────────────────────────────


def _run_validate(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    """Handler for ``gwascatalog beyondsnp validate``.

    Returns 0 on success, 1 if any file failed validation.
    """
    files = _resolve_inputs(args.inputs)
    if not files:
        parser.error("No input files found")

    output_dir: Path = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Validating {len(files)} file(s)")
    print(f"Output: {output_dir}\n")

    config = SumstatConfig(
        allow_zero_p_values=args.allow_zero_pvalues,
        primary_effect_size=args.primary_effect_size,
        assembly=args.assembly,
    )

    # ── Dispatch ──────────────────────────────────────────────
    results: list[FileResult] = []

    # Sequential — simple and easy to debug
    for f in files:
        print(f"  {f.name} ...", end=" ", flush=True)
        result = validate_file(
            input_path=str(f),
            config=config,
            output_dir=output_dir,
            variation_type=args.variation_type,
        )
        passed = not result.fatal_error and result.error_count == 0
        print("PASS" if passed else "FAIL")
        results.append(result)

    _print_summary(results)

    has_failures = any(r.error_count > 0 or r.fatal_error is not None for r in results)
    return 1 if has_failures else 0


# ── Main ──────────────────────────────────────────────────────────


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point for the ``gwascatalog`` CLI."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.WARNING,
        format="%(levelname)s: %(message)s",
    )

    return args.func(args, parser)


if __name__ == "__main__":
    sys.exit(main())
