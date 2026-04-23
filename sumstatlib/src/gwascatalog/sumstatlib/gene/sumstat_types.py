from __future__ import annotations

from typing import Annotated, Any

from gwascatalog.sumstatlib._pydantic import (
    Field,
    PositiveInt,
    StringConstraints,
)


def empty_string_to_none(v: Any) -> Any:
    if v == "":
        return None
    return v


# reject lowercase letters and any punctuation
# ... (rest of hgnc_regex)
hgnc_regex = r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$"

HGNCGeneSymbol = Annotated[
    str,
    StringConstraints(pattern=hgnc_regex),
    Field(
        description="HGNC symbol",
        examples=["ISG20", "A2M", "A4GALT", "HLA-DRA", "MT-ND1"],
    ),
]

# human ensembl gene IDs:
# ... (rest of ensembl_regex)
ensembl_regex = r"^ENSG\d{11}"
EnsemblGeneID = Annotated[
    str,
    StringConstraints(min_length=15, max_length=15, pattern=ensembl_regex),
    Field(
        description="Ensembl gene identifier",
        examples=["ENSG00000172183", "ENSG00000219481"],
    ),
]

NumberOfSNPs = Annotated[
    PositiveInt, Field(description="Number of SNPs included in the gene-based test")
]
