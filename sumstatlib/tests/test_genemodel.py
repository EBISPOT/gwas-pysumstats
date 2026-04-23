import pytest
from pydantic import ValidationError

from gwascatalog.sumstatlib.gene.models import GeneSumstatModel

# disallow should be default
validation_context = {"allow_zero_pvalues": False, "primary_effect_size": None}

# each test case is (input_data, context, expected_error, test_id)
test_cases = [
    # valid cases
    (
        {
            "ensembl_gene_id": "ENSG00000172183",
            "chromosome": 1,
            "base_pair_start": 2,
            "base_pair_end": 1000,
            "p_value": 0.0001,
        },
        validation_context,
        None,
        "minimal_valid_ensembl_gene",
    ),
    (
        {
            "hgnc_symbol": "ISG20",
            "chromosome": 1,
            "base_pair_start": 2,
            "base_pair_end": 1000,
            "z_score": 1,
            "p_value": 0.0001,
            "n_snps": 100,
        },
        validation_context,
        None,
        "valid_hgnc_with_z_score_and_n_snps",
    ),
    (
        {
            "ensembl_gene_id": "ENSG00000172183",
            "chromosome": 1,
            "base_pair_start": 2,
            "base_pair_end": 1000,
            "odds_ratio": 1,
            "confidence_interval_lower": 0,
            "confidence_interval_upper": 2,
            "p_value": 0.0001,
        },
        validation_context,
        None,
        "valid_ensembl_with_odds_ratio",
    ),
    # invalid cases
    # missing a gene name
    (
        {
            "p_value": 0.0001,
            "chromosome": 1,
            "base_pair_start": 2,
            "base_pair_end": 1000,
        },
        validation_context,
        "Missing ensembl_gene_id or hgnc_symbol",
        "missing_gene_name",
    ),
    (
        {
            "ensembl_gene_id": "ENSG00000172183",
            "hgnc_symbol": None,
            "chromosome": 1,
            "base_pair_start": 2,
            "base_pair_end": 1000,
            "z_score": 5,
            "beta": 2,
            "standard_error": 0.01,
            "p_value": 0.0001,
        },
        validation_context,
        "More than one effect size field is set",
        "invalid_multiple_effect_sizes",
    ),
    (
        {
            "hgnc_symbol": "ISG20",
            "z_score": 3,
            "p_value": 0.0001,
            "chromosome": 1,
            "base_pair_start": 1000,
            "base_pair_end": 100,
        },
        validation_context,
        "base_pair_end must be greater than base_pair_start",
        "bad_location",
    ),
    (
        {
            "hgnc_symbol": "ISG20",
            "z_score": 3,
            "p_value": 0.0001,
            "base_pair_start": 1000,
            "base_pair_end": 1100,
        },
        validation_context,
        "Field required",
        "missing_chromosome",
    ),
    (
        {
            "hgnc_symbol": "ISG20",
            "z_score": 3,
            "p_value": 0.0001,
            "chromosome": 1,
            "base_pair_start": 1000,
        },
        validation_context,
        "Field required",
        "missing end position",
    ),
]


@pytest.mark.parametrize(
    "input_data,context,expected_error,test_id",
    test_cases,
    ids=[tc[3] for tc in test_cases],
)
def test_genemodel(input_data, context, expected_error, test_id):
    if expected_error is None:
        _ = GeneSumstatModel.model_validate(input_data, context=context)
        assert True
    else:
        with pytest.raises(ValidationError, match=expected_error):
            GeneSumstatModel.model_validate(input_data, context=context)
