import { Router, Request, Response } from "express";
import { createPolicy, listPolicies, policies, PolicyInput } from "../state";

const router = Router();

router.post("/policies", (req: Request, res: Response) => {
  const { name, threshold, delay_seconds } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    return res.status(400).json({ error: "threshold must be a number" });
  }

  if (typeof delay_seconds !== "number" || !Number.isFinite(delay_seconds)) {
    return res.status(400).json({ error: "delay_seconds must be a number" });
  }

  const policy: PolicyInput = {
    name: name.trim(),
    threshold,
    delay_seconds,
  };

  const created = createPolicy(policy);
  policies.push(created);

  return res.status(201).json({
    status: "saved",
    policy_id: created.id,
  });
});

router.get("/policies", (_req: Request, res: Response) => {
  return res.json(listPolicies());
});

export default router;
