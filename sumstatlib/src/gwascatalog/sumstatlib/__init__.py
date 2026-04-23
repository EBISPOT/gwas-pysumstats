import importlib.metadata

try:
    __version__ = importlib.metadata.version("gwascatalog.sumstatlib")
except importlib.metadata.PackageNotFoundError:
    __version__ = "dev"

from gwascatalog.sumstatlib.cnv.models import CNVSumstatModel
from gwascatalog.sumstatlib.core.sumstat_enums import GenomeAssembly
from gwascatalog.sumstatlib.gene.models import GeneSumstatModel
from gwascatalog.sumstatlib.sumstattable import (
    SumstatConfig,
    SumstatError,
    SumstatTable,
    SumstatWriter,
    ValidatedRow,
)

__all__ = [
    "CNVSumstatModel",
    "GeneSumstatModel",
    "SumstatConfig",
    "SumstatError",
    "SumstatTable",
    "SumstatWriter",
    "ValidatedRow",
    "GenomeAssembly",
]
