import { listProofs as listStoredProofs, Proof, storeProof as storeStoredProof } from "../state";

export function storeProof(proof: Proof): Proof {
  return storeStoredProof(proof);
}

export function listProofs(): Proof[] {
  return listStoredProofs();
}
