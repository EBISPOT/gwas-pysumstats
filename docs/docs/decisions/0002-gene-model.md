# Define gene-based GWAS summary statistics data model

Date: 2026-01-26

## Status

Proposed

## Context

We'd like to ingest gene-based GWAS analyses into the GWAS Catalog.

There are no standard schemas or recommended data formats for authors. Data are
submitted and only hosted on the GWAS Catalog FTP without any ingest processes.
This prevents consistent validation, indexing, and downstream reuse.

As of 2025-04-01, 5,648 summary statistics files were identified by GWAS Catalog
curators as including gene-based analyses. A review of these files found
inconsistent data structure and field names. After checking shared fields and
common data patterns, a data model was proposed.

## Decision

### Mandatory fields

| Field             | Validation notes                                                                     |
|-------------------|--------------------------------------------------------------------------------------|
| ensembl_gene_id   | At least one gene identifier MUST be provided; preferred ID format `ENSG00000000000` |
| hgnc_symbol       | Required if `ensembl_gene_id` is not provided; string, official HGNC symbol          |
| p_value           | Float in (0,1]; mutually exclusive with `neg_log10_p_value`                          |
| neg_log10_p_value | Float ≥ 0; mutually exclusive with `p_value`                                         |
| chromosome        | Integer; must match GWAS-SSF standard (1-22, X = 23, Y = 24, MT = 25)                |
| base_pair_start   | Positive integer; genomic start co-ordinate                                          |
| base_pair_end     | Positive integer; genomic end co-ordinate; must satisfy `end > start`                |

### Optional fields

| Field        | Validation notes                                                            |
|--------------|-----------------------------------------------------------------------------|
| beta         | A primary effect size must be indicated; float                              |
| odds_ratio   | A primary effect size must be indicated; float                              |
| hazard_ratio | A primary effect size must be indicated; float                              |
| z_score      | A primary effect size must be indicated; float                              |
| n            | Positive integer; number of samples contributing to this association record |
| n_snps       | Positive integer; number of SNPs included in the gene-based test            |

Effect size is currently optional because many existing studies do not include a
measure of effect size, and we have received feedback that lists of genes and p-values
are a valuable resource for the community.

A primary effect size only needs to be provided if more than one effect size is
reported.

### Conditional fields

| Field                     | Validation notes                                   |
|---------------------------|----------------------------------------------------|
| standard_error            | Required if `beta` is provided; float              |
| confidence_interval_lower | Required if `odds_ratio` is provided; float        |
| confidence_interval_upper | Required if `odds_ratio` is provided; float        |

### Custom fields

Authors may choose to include a reasonable number of custom fields, which will
be included after mandatory and optional fields.

### Metadata

No structural changes are required to the GWAS Catalog metadata schema, except
adding an enumerated and mutually exclusive flag to indicate the type of genetic
variation being studied (e.g. gene-based, SNP, CNV). Fields like genome assembly
are defined in the metadata schema.

Files are expected to contain at least 10,000 rows; smaller files may be
rejected or flagged for review. This heuristic is based on a survey of existing
submissions which found a minimum of 13,674 and a maximum of 15,578,185 rows.
Given that there are roughly 20,000 protein-coding genes in the human genome,
and that the GWAS Catalog accepts only genome-wide (not targeted) analyses,
substantially smaller files are unlikely to represent valid gene-based GWAS
results.

### Source of truth

The canonical representation of the data model is the Pydantic model defined in
this repository.

Required context will be injected during validation from the
GWAS Catalog metadata schema as needed (e.g. assembly, co-ordinate system).

Documentation will be generated from the annotated Pydantic model.

### Output format

The model is responsible for defining output fields in a standardised way,
like gwas-ssf. Custom fields are appended after the standard fields.

Records will always be sorted by `chromosome` and `base_pair_start`.

## Consequences

Currently, most gene-based GWAS authors share lots of data with the GWAS Catalog,
although this information is unstructured.

After integrating this model with GWAS Catalog data ingest processes, authors
must now provide gene names, p-values, and gene positions. This improves
consistency and enables spatial indexing.

User feedback indicates the minimum data (including position) has significant value, and
other resources collect this kind of data (e.g. OpenTargets).

We will accept and monitor the risk of slightly higher barriers to entry in exchange for
consistency, searchability, and interoperability.

The data model is designed to allow additional fields in the future to respond
to evolving community requirements. However, some future additions may not be
backwards-compatible. Consumers of the data should account for potential schema
evolution when designing pipelines.
