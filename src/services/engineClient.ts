import { DecisionAction, PolicySnapshot } from "../state";

export type EngineDecision = {
  action: DecisionAction;
  delay_seconds: number;
};

function getEngineUrl(): string {
  const engineUrl = process.env.ENGINE_URL ?? "http://localhost:3001";
  return engineUrl.replace(/\/+$/, "");
}

export async function evaluateWithEngine(input: {
  carbon_value: number;
  policy: PolicySnapshot;
}): Promise<EngineDecision> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const response = await fetch(`${getEngineUrl()}/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    signal: controller.signal,
    body: JSON.stringify(input),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`engine returned ${response.status}`);
  }

  const data = (await response.json()) as Partial<EngineDecision>;
  const action = data.action === "DEFER" ? "DEFER" : "RUN";
  const delay_seconds =
    typeof data.delay_seconds === "number" && Number.isFinite(data.delay_seconds) && data.delay_seconds >= 0
      ? data.delay_seconds
      : 0;

  return {
    action,
    delay_seconds,
  };
}
