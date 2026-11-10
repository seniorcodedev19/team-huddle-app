import cors from "cors";
import express, { type Request } from "express";
import { authenticate } from "./auth";
import { publicAuth } from "./routes/auth";
import { core } from "./routes/core";
import { interviews } from "./routes/interviews";
import { metrics } from "./routes/metrics";
import { notifications } from "./routes/notifications";
import { profiles } from "./routes/profiles";
import { time } from "./routes/time";
import { week } from "./routes/week";
import { agent } from "./routes/agent";
import { slackEvents } from "./routes/slackEvents";
import { errorHandler } from "./util";

const app = express();

app.use(
  express.json({
    limit: "400kb",
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf.toString("utf8");
    },
  }),
);
app.use(cors({ origin: process.env.WEB_ORIGIN, credentials: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(publicAuth);
app.use(slackEvents);
app.use(authenticate);
app.use(core);
app.use(metrics);
app.use(week);
app.use(time);
app.use(interviews);
app.use(profiles);
app.use(notifications);
app.use(agent);
app.use(errorHandler);

export default app;
