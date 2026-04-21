import { randomUUID } from "crypto";

export type PolicyInput = {
  name: string;
  threshold: number;
  delay_seconds: number;
};

export type Policy = PolicyInput & {
  id: string;
  created_at: string;
};

export type PolicySnapshot = Pick<Policy, "threshold" | "delay_seconds">;

export type DecisionAction = "RUN" | "DEFER";

export type Proof = {
  id: string;
  job_id: string;
  carbon_value: number;
  action: DecisionAction;
  delay_seconds: number;
  policy: PolicySnapshot;
  timestamp: string;
};

export const policies: Policy[] = [];
export const proofs: Proof[] = [];

export function createPolicy(input: PolicyInput): Policy {
  return {
    id: randomUUID(),
    name: input.name,
    threshold: input.threshold,
    delay_seconds: input.delay_seconds,
    created_at: new Date().toISOString(),
  };
}

export function getLatestPolicy(): Policy | undefined {
  return policies[policies.length - 1];
}

export function listPolicies(): Policy[] {
  return policies.map((policy) => ({ ...policy }));
}

export function storeProof(proof: Proof): Proof {
  const snapshot = {
    ...proof,
    policy: { ...proof.policy },
  };

  proofs.push(snapshot);
  return snapshot;
}

export function listProofs(): Proof[] {
  return proofs.map((proof) => ({
    ...proof,
    policy: { ...proof.policy },
  }));
}
