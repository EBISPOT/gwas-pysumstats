# Changelog

## 2026-04-23

## gwascatalog.sumstatapp 0.1.1

* Make position information mandatory across genes and CNVs in web UI checklist

### gwascatalog.sumstatlib 1.0.0

* **Breaking change**: Gene-based GWAS position fields (`chromosome`, `base_pair_start`, `base_pair_end`) are now mandatory.
* Added `n_snps` field to `GeneSumstatModel` to represent the number of SNPs included in a gene-based test.
* Improved CSV parsing robustness by automatically converting empty strings to `None` for optional fields.

## 2026-03-10

* Initial release `gwascatalog.sumstatlib 0.1.0`
* Initial release `gwascatalog.sumstatapp 0.1.0`
