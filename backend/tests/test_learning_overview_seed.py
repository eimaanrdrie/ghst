def test_learning_seed_records_are_coherent(client, reviewer_headers, policy_headers):
    calibrations_response = client.get("/api/v1/learning/calibrations", headers=reviewer_headers)
    assert calibrations_response.status_code == 200, calibrations_response.text
    calibrations = calibrations_response.json()

    assert len(calibrations) == 3
    assert {item["status"] for item in calibrations} == {"ACTIVE", "DRAFT", "RETIRED"}
    assert sum(int(item["evidence"].get("validated_reviews", 0)) for item in calibrations) == 248

    models_response = client.get("/api/v1/learning/models", headers=reviewer_headers)
    assert models_response.status_code == 200, models_response.text
    models = models_response.json()

    assert "Long-context candidate for legal-and-finance blended review v2026.07" not in {
        item["model_name"] for item in models
    }

    by_status = {item["status"]: item for item in models}
    assert {"PRODUCTION", "RETIRED", "SHADOW"} <= set(by_status)

    production = by_status["PRODUCTION"]
    assert production["approved_by"]
    assert production["deployed_at"]
    assert production["metrics"]["evaluated"] is True
    assert production["metrics"]["held_out_recall"] >= 0.95
    assert production["metrics"]["macro_f1"] >= 0.85
    assert production["metrics"]["secret_false_allows"] <= 1

    shadow = by_status["SHADOW"]
    assert shadow["approved_by"] is None
    assert shadow["deployed_at"] is None
    assert shadow["metrics"]["evaluated"] is True

    pending_calibration_approvals = sum(1 for item in calibrations if item["status"] == "DRAFT")
    pending_model_approvals = sum(1 for item in models if item["status"] == "SHADOW")
    assert pending_calibration_approvals + pending_model_approvals == 2

    jobs_response = client.get("/api/v1/learning/model-jobs", headers=policy_headers)
    assert jobs_response.status_code == 200, jobs_response.text
    jobs = jobs_response.json()
    assert any(
        item["model_name"] == "Private QLoRA adapter v3.2" and item["status"] == "CANDIDATE_CREATED"
        for item in jobs
    )
