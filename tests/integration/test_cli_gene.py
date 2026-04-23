import csv
import gzip
import shutil
import sys
from pathlib import Path

import pytest


@pytest.fixture
def invalid_test_gene_file(tmp_path):
    gene_test_path = tmp_path / "invalid_gene.csv"
    test_gene_file = (
        Path(__file__).parent.parent.parent
        / "src"
        / "gwascatalog"
        / "sumstatapp"
        / "web"
        / "static"
        / "examples"
        / "invalid-gene.csv"
    )
    return shutil.copyfile(test_gene_file, gene_test_path)


@pytest.fixture
def valid_gene_output_columns():
    return {
        "ensembl_gene_id",
        "chromosome",
        "base_pair_start",
        "base_pair_end",
        "p_value",
        "beta",
        "standard_error",
        "n_snps",
        "extra_test_column",
    }


@pytest.fixture
def invalid_gene_errors():
    return {
        ("0", "", "Value error, Only one of ensembl_gene_id or hgnc_symbol may be set"),
        ("1", "", "Value error, Missing p-value and negative log-10 p-value"),
        ("2", "", "Value error, base_pair_end must be greater than base_pair_start"),
    }


@pytest.fixture
def valid_test_gene_file(tmp_path):
    gene_test_path = tmp_path / "valid_gene.csv"
    test_gene_file = (
        Path(__file__).parent.parent.parent
        / "src"
        / "gwascatalog"
        / "sumstatapp"
        / "web"
        / "static"
        / "examples"
        / "valid-gene.csv"
    )
    return shutil.copyfile(test_gene_file, gene_test_path)


def test_cli_gene_valid(
    monkeypatch, valid_test_gene_file, tmp_path, valid_gene_output_columns
):
    in_path = valid_test_gene_file
    out_dir = tmp_path / "test_cli_gene_valid"
    out_dir.mkdir()

    args = [
        "gwascatalog",
        "beyondsnp",
        "validate",
        str(in_path),
        "--type",
        "GENE",
        "--output-dir",
        str(out_dir),
    ]

    # run the CLI
    monkeypatch.setattr(sys, "argv", args)
    from gwascatalog.sumstatapp.cli.__main__ import main

    main()

    # check the CLI ran OK
    out_path = out_dir / f"validated_{in_path.stem}.tsv.gz"
    assert out_path.exists()
    with gzip.open(out_path, mode="rt") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for i, row in enumerate(reader, start=1):
            assert set(row.keys()) == valid_gene_output_columns
            assert row["extra_test_column"] == f"test{i}"


def test_cli_gene_invalid(
    monkeypatch, invalid_test_gene_file, tmp_path, invalid_gene_errors
):
    in_path = invalid_test_gene_file
    out_dir = tmp_path / "test_cli_gene_invalid"
    out_dir.mkdir()

    args = [
        "gwascatalog",
        "beyondsnp",
        "validate",
        str(in_path),
        "--type",
        "GENE",
        "--output-dir",
        str(out_dir),
    ]

    # run the CLI
    monkeypatch.setattr(sys, "argv", args)
    from gwascatalog.sumstatapp.cli.__main__ import main

    main()

    with (out_dir / f"{in_path.stem}.errors.tsv").open() as f:
        rows = set()
        for row in csv.DictReader(f, delimiter="\t"):
            rows.add(tuple(row.values()))
        assert rows == invalid_gene_errors
