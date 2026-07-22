import test from "node:test";
import assert from "node:assert/strict";

import { deriveLearningOverviewState, type LearningCalibration, type LearningModel } from "../lib/learning-overview.ts";

function calibration(overrides: Partial<LearningCalibration>): LearningCalibration {
  return {
    id: "calibration-id",
    version: "CAL-TEST",
    status: "DRAFT",
    evidence: {},
    created_at: "2026-07-21T00:00:00Z",
    ...overrides,
  };
}

function model(overrides: Partial<LearningModel>): LearningModel {
  return {
    id: "model-id",
    model_name: "Model under test",
    adapter_type: "QLORA",
    status: "CANDIDATE",
    metrics: {},
    created_at: "2026-07-21T00:00:00Z",
    ...overrides,
  };
}

test("empty overview shows not started and blocks dependent stages", () => {
  const state = deriveLearningOverviewState([], []);

  assert.deepEqual(state.summary, {
    verifiedCases: 0,
    recommendations: 0,
    candidateCount: 0,
    awaitingApproval: 0,
  });

  assert.equal(state.lifecycle[0]?.statusText, "Not started");
  for (const step of state.lifecycle.slice(1)) {
    assert.equal(step.disabled, true);
    assert.equal(step.statusText, "Blocked");
  }
  assert.equal(state.productionModel, null);
});

test("partial overview keeps downstream stages blocked until prerequisites exist", () => {
  const state = deriveLearningOverviewState(
    [
      calibration({
        id: "draft-calibration",
        version: "CAL-2026-018",
        status: "DRAFT",
        evidence: { validated_reviews: 84 },
      }),
    ],
    [],
  );

  assert.equal(state.summary.verifiedCases, 84);
  assert.equal(state.summary.recommendations, 1);
  assert.equal(state.lifecycle[0]?.statusText, "Complete");
  assert.equal(state.lifecycle[1]?.statusText, "In progress");
  assert.equal(state.lifecycle[2]?.disabled, true);
  assert.equal(state.lifecycle[5]?.disabled, true);
});

test("populated overview derives coherent seeded counts and pending approvals", () => {
  const state = deriveLearningOverviewState(
    [
      calibration({
        id: "cal-retired",
        version: "CAL-2026-016",
        status: "RETIRED",
        evidence: { validated_reviews: 82 },
        approved_by: "policy-admin",
        activated_at: "2026-07-18T00:00:00Z",
      }),
      calibration({
        id: "cal-active",
        version: "CAL-2026-017",
        status: "ACTIVE",
        evidence: { validated_reviews: 82 },
        approved_by: "policy-admin",
        activated_at: "2026-07-19T00:00:00Z",
      }),
      calibration({
        id: "cal-draft",
        version: "CAL-2026-018",
        status: "DRAFT",
        evidence: { validated_reviews: 84 },
      }),
    ],
    [
      model({
        id: "retired-model",
        model_name: "Qwen3.5:4B + GHST adapter v2.9",
        status: "RETIRED",
        approved_by: "policy-admin",
        deployed_at: "2026-07-18T00:00:00Z",
        metrics: { evaluated: true },
      }),
      model({
        id: "production-model",
        model_name: "Qwen3.5:4B + GHST adapter v3.1",
        status: "PRODUCTION",
        approved_by: "policy-admin",
        deployed_at: "2026-07-19T00:00:00Z",
        previous_model_id: "retired-model",
        metrics: {
          evaluated: true,
          held_out_recall: 0.978,
          macro_f1: 0.941,
          secret_false_allows: 0.8,
          p95_latency_ms: 620,
        },
      }),
      model({
        id: "shadow-model",
        model_name: "Private QLoRA adapter v3.2",
        status: "SHADOW",
        metrics: {
          evaluated: true,
          held_out_recall: 0.972,
          macro_f1: 0.934,
          secret_false_allows: 0,
          p95_latency_ms: 640,
        },
      }),
    ],
  );

  assert.deepEqual(state.summary, {
    verifiedCases: 248,
    recommendations: 3,
    candidateCount: 1,
    awaitingApproval: 2,
  });
  assert.equal(state.productionModel?.status, "PRODUCTION");
  assert.equal(state.latestCandidate?.status, "SHADOW");
  assert.equal(state.lifecycle[0]?.statusText, "Complete");
  assert.equal(state.lifecycle[1]?.statusText, "Complete");
  assert.equal(state.lifecycle[2]?.statusText, "Complete");
  assert.equal(state.lifecycle[3]?.statusText, "Complete");
  assert.equal(state.lifecycle[4]?.statusText, "Complete");
  assert.equal(state.lifecycle[5]?.statusText, "In progress");
});

test("production model requires explicit promotion evidence", () => {
  const state = deriveLearningOverviewState(
    [],
    [
      model({
        id: "demo-production",
        status: "PRODUCTION",
        approved_by: null,
        deployed_at: undefined,
        metrics: { evaluated: true },
      }),
    ],
  );

  assert.equal(state.productionModel, null);
});
