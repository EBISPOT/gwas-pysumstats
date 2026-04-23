# Always sort validated output by `chromosome` and `base_pair_start`

Date: 2026-03-03

## Status

Accepted

## Context

Input records are used to instantiate Pydantic models for structural validation.

After validation, these records are written to a compressed TSV file with a standard column order. The column order is defined by the Pydantic model, similar to GWAS-SSF.

However, there are no guarantees that input records are sorted. Files submitted to the GWAS Catalog
before GWAS-SSF was formalised had no guarantees about sorting.

When the GWAS Catalog tried indexing these files, it failed because tabix requires sorted input data. Tabix is a popular method of retrieving ranges of records from a larger file in bioinformatics.

Efficient memory usage is a big concern because `sumstatlib` is deployed to WebAssembly, with an in-memory filesystem.

## Decision

CNV records will always have `chromosome` and `base_pair_start` records, and must always be sorted.

`chromosome` and `base_pair_start` are canonically represented as integers in the Pydantic model, so numeric ordering is simple to implement.

Gene records will also always have `chromosome` and `base_pair_start` records, and must always be sorted.

Sorting is done with the Python's standard `sorted()` (Timsort). This approach assumes input files are small enough to fit in memory in their validated representation. In practice input data are around 700MB - 1GB at most.

### Alternatives considered

Use the [heap queue algorithm](https://docs.python.org/3/library/heapq.html) in Python to do an external merge sort. The external merge sort processes files in chunks to fit data which may be larger than RAM.

This makes sense on a traditional file system, but not for memory-backed file systems. On MEMFS platforms (WebAssembly / Emscripten) there's no memory benefit from writing temporary files and merging them, and considerable downsides (increased complexity). WebAssembly memory ceilings are strict and non-expandable.

## Consequences

CNV GWAS files are guaranteed to be sorted by (chromosome, base_pair_start).

Gene-based GWAS files are partially sorted when possible. A file may contain a mixture of records with location and without location information. Records missing location information are appended to the end of the file.

Tabix indexes can be created for TSV files in the future now. However, it's not clear if this will actually be done. Parquet is a popular TSV alternative under consideration. In this case, tabix would no longer be compatible. Sorting is less important for Parquet because:

- Columnar formats like Parquet do not require global row ordering
- Range queries are handled via column statistics and predicate pushdown

If input files increase in size in the future then sorting everything in memory will no longer be scalable.