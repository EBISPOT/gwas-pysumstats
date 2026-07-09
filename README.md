# GWAS Catalog: Beyond SNPs

[![CI](https://github.com/EBISPOT/gwas-beyond-snps/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/EBISPOT/gwas-beyond-snps/actions/workflows/ci.yaml)
![PyPI - Version](https://img.shields.io/pypi/v/gwascatalog.sumstatapp)

This Python monorepo contains packages and documentation designed to help users prepare non-SNP GWAS summary statistics for submission to the [GWAS Catalog](https://ebi.ac.uk/gwas).

## What kind of data are supported?

| Type of genetic variant              | Supported                                                                     |
|--------------------------------------|-------------------------------------------------------------------------------|
| Single nucleotide polymorphism (SNP) | ❌, see [`gwas-sumstats-tools`](https://github.com/ebispot/gwas-sumstats-tools) |
| Copy number variant (CNV)            | ✅                                                                            |
| Gene                                 | ✅                                                                            |

## Using the validation CLI for bulk data processing


> [!TIP]
> If you prefer not to work in a terminal or you [find it difficult to use please try the web app](https://www.ebi.ac.uk/gwas/apps/beyond-snps/validate/)


First, [install uv](https://docs.astral.sh/uv/), then run:

```
$ uvx --from 'gwascatalog-sumstatapp[pydantic]' \
    gwascatalog beyondsnp validate --help
```

You should see:

```
Validate GWAS summary statistics files for submission to the GWAS Catalog.

positional arguments:
  INPUT                 Files to validate

options:
  -h, --help            show this help message and exit
  --type {CNV,GENE}     Type of genetic variation (CNV or GENE)
  --assembly {GRCh38,GRCh37,NCBI36,NCBI35,NCBI34}
                        Genome assembly (e.g. GRCh38)
  --effect-size {beta,odds_ratio,hazard_ratio,z_score}
                        Primary effect size measure
  --allow-zero-pvalues  Accept zero as a valid p-value
  -o, --output-dir OUTPUT_DIR
                        Output directory for results (default: ./validated/)
```

The package is [also available from PyPI](https://pypi.org/project/gwascatalog.sumstatapp/). You should always install the `pydantic` extra:

```
$ pipx install "gwascatalog.sumstatapp[pydantic]"
```

## Documentation

See [our docs here](https://www.ebi.ac.uk/gwas/apps/beyond-snps/). Please create an issue or email gwas-info@ebi.ac.uk if you have any questions or comments. We appreciate community feedback.

## Developer notes 

This repository is a [`uv`](https://docs.astral.sh/uv/) workspace containing two Python packages:

- `sumstatlib`: [Pydantic models and validation public interfaces](sumstatlib)
- `sumstatapp`: data validation applications which uses sumstatlib internally, containing two deployment approaches:
  - A [Pyodide](https://github.com/pyodide/pyodide) web application, [responsible for browser-based data validation](src/gwascatalog/sumstatapp/web)
  - A [standard CLI for bulk data processing](src/gwascatalog/sumstatapp/cli) and eventual integration with the GWAS Catalog backend

### User facing website

* The `docs` directory contains a [docusaurus](https://docusaurus.io/) website
* This is the landing page for non-SNP GWAS Catalog submissions, and the compiled static site will be deployed to https://ebi.ac.uk/gwas/apps/beyond-snps
* A [custom docusaurus build process](docs/package.json#L11) is responsible for building the sumstatlib wheel and bundling the sumstatapp web directory as static content

### Building the beyond SNPs static site

Development build (assumes deployed to `/` on `localhost:8000`):

```
$ cd docs
$ npm run build:dev
$ npm run serve 
```

Production build (assumes deployed to a base URL: `gwas/apps/beyond-snps`)

```
$ cd docs
$ npm run build
```

Deploying the static site is pretty simple: just put the compiled assets somewhere (a bucket, a docker image, etc.).

