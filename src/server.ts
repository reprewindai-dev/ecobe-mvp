import express, { NextFunction, Request, Response } from "express";
import policiesRouter from "./routes/policies";
import decisionRouter from "./routes/decision";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "ecobe-mvp",
  });
});

app.use(policiesRouter);
app.use(decisionRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "internal server error";
  res.status(500).json({ error: message });
});

export { app };

if (require.main === module) {
  app.listen(port, () => {
    console.log(`ecobe-mvp listening on port ${port}`);
  });
}
