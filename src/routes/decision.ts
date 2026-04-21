import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { evaluateWithEngine } from "../services/engineClient";
import { generateCarbonValue } from "../services/signalProvider";
import {
  DecisionAction,
  getLatestPolicy,
  listProofs,
  PolicySnapshot,
  Proof,
  storeProof,
} from "../state";

const router = Router();

const DEFAULT_POLICY = {
  name: "default-carbon-cap",
  threshold: 400,
  delay_seconds: 300,
} as const;

function getActivePolicy(): PolicySnapshot {
  const latest = getLatestPolicy();
  if (latest) {
    return {
      threshold: latest.threshold,
      delay_seconds: latest.delay_seconds,
    };
  }

  return {
    threshold: DEFAULT_POLICY.threshold,
    delay_seconds: DEFAULT_POLICY.delay_seconds,
  };
}

router.post("/decision", async (req: Request, res: Response) => {
  const { job_id, timestamp, workload_type } = req.body ?? {};

  if (typeof job_id !== "string" || !job_id.trim()) {
    return res.status(400).json({ error: "job_id is required" });
  }

  if (typeof timestamp !== "string" || !timestamp.trim()) {
    return res.status(400).json({ error: "timestamp is required" });
  }

  if (typeof workload_type !== "string" || !workload_type.trim()) {
    return res.status(400).json({ error: "workload_type is required" });
  }

  const policy = getActivePolicy();
  const carbon_value = generateCarbonValue(`${job_id}:${timestamp}:${workload_type}:${policy.threshold}:${policy.delay_seconds}`);

  let action: DecisionAction = "RUN";
  let delay_seconds = 0;

  try {
    const engineDecision = await evaluateWithEngine({ carbon_value, policy });
    action = engineDecision.action;
    delay_seconds = engineDecision.action === "DEFER" ? engineDecision.delay_seconds : 0;
  } catch {
    action = "RUN";
    delay_seconds = 0;
  }

  const proof: Proof = {
    id: randomUUID(),
    job_id,
    carbon_value,
    policy: { ...policy },
    action,
    delay_seconds,
    timestamp,
  };

  storeProof(proof);

  return res.json({
    action,
    delay_seconds,
    proof_id: proof.id,
    carbon_value,
  });
});

router.get("/proofs", (_req: Request, res: Response) => {
  return res.json(listProofs());
});

export default router;
