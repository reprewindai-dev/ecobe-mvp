import { createHash } from "crypto";

export function generateCarbonValue(seed: string): number {
  const min = 100;
  const max = 600;
  const range = max - min + 1;
  const digest = createHash("sha256").update(seed).digest();
  const value = digest.readUInt32BE(0) % range;

  return min + value;
}
