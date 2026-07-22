export type LearningCalibration = {
  id: string;
  version: string;
  status: string;
  evidence: Record<string, number>;
  created_at: string;
  approved_by?: string | null;
  activated_at?: string | null;
};

export type LearningModel = {
  id: string;
  model_name: string;
  adapter_type: string;
  status: string;
  metrics: Record<string, unknown>;
  previous_model_id?: string;
  approved_by?: string | null;
  deployed_at?: string;
  created_at?: string;
};

export type LearningLifecycleStep = {
  label: string;
  statusText: string;
  complete: boolean;
  current: boolean;
  disabled: boolean;
};

export type LearningOverviewState = {
  summary: {
    verifiedCases: number;
    recommendations: number;
    candidateCount: number;
    awaitingApproval: number;
  };
  lifecycle: LearningLifecycleStep[];
  activeCalibration: LearningCalibration | null;
  latestCalibrationDraft: LearningCalibration | null;
  productionModel: LearningModel | null;
  shadowModel: LearningModel | null;
  latestCandidate: LearningModel | null;
};

export function deriveLearningOverviewState(
  calibrations: LearningCalibration[],
  models: LearningModel[],
): LearningOverviewState {
  const activeCalibration = calibrations.find((item) => item.status === "ACTIVE") || null;
  const latestCalibrationDraft = calibrations.find((item) => item.status === "DRAFT") || null;
  const productionModel =
    models.find((model) => model.status === "PRODUCTION" && Boolean(model.approved_by) && Boolean(model.deployed_at)) || null;
  const shadowModel = models.find((model) => model.status === "SHADOW") || null;
  const latestCandidate =
    shadowModel ||
    models.find((model) => model.status === "EVALUATED") ||
    models.find((model) => model.status === "CANDIDATE") ||
    null;

  const verifiedCases = calibrations.reduce((total, item) => total + Number(item.evidence.validated_reviews || 0), 0);
  const recommendations = calibrations.length;
  const candidateCount = latestCandidate ? 1 : 0;
  const awaitingApproval = (latestCalibrationDraft ? 1 : 0) + (shadowModel ? 1 : 0);

  const evidenceComplete = verifiedCases > 0;
  const evidenceCurrent = !evidenceComplete && calibrations.length > 0;
  const calibrationComplete = evidenceComplete && !!activeCalibration;
  const calibrationCurrent = evidenceComplete && !calibrationComplete && calibrations.length > 0;
  const candidateComplete = calibrationComplete && !!latestCandidate;
  const candidateCurrent =
    calibrationComplete &&
    !candidateComplete &&
    models.some((model) => model.status === "CANDIDATE" || model.status === "EVALUATED");
  const evaluationPassed =
    candidateComplete &&
    latestCandidate
      ? Boolean(latestCandidate.metrics.evaluated)
      : models.some((model) => ["SHADOW", "PRODUCTION"].includes(model.status) && Boolean(model.metrics.evaluated));
  const evaluationCurrent = candidateComplete && !evaluationPassed;
  const shadowActive = evaluationPassed && !!shadowModel;
  const shadowCurrent = evaluationPassed && !shadowActive && models.some((model) => model.status === "EVALUATED");
  const approvalPending = evaluationPassed && awaitingApproval > 0;

  const lifecycle: LearningLifecycleStep[] = [
    stage("Evidence complete", evidenceComplete, evidenceCurrent, false),
    stage("Calibration complete", calibrationComplete, calibrationCurrent, !evidenceComplete),
    stage("Candidate complete", candidateComplete, candidateCurrent, !calibrationComplete),
    stage("Evaluation passed", evaluationPassed, evaluationCurrent, !candidateComplete),
    stage("Shadow active", shadowActive, shadowCurrent, !evaluationPassed),
    stage("Approval pending", false, approvalPending, !evaluationPassed),
  ];

  return {
    summary: { verifiedCases, recommendations, candidateCount, awaitingApproval },
    lifecycle,
    activeCalibration,
    latestCalibrationDraft,
    productionModel,
    shadowModel,
    latestCandidate,
  };
}

function stage(label: string, complete: boolean, current: boolean, disabled: boolean): LearningLifecycleStep {
  const statusText = disabled ? "Blocked" : complete ? "Complete" : current ? "In progress" : "Not started";
  return { label, statusText, complete, current, disabled };
}
