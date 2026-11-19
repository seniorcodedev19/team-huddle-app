import cors from "cors";
import express, { type Request } from "express";
import { authenticate } from "./auth";
import { publicAuth } from "./routes/auth";
import { contacts } from "./routes/contacts";
import { core } from "./routes/core";
import { interviews } from "./routes/interviews";
import { manictime } from "./routes/manictime";
import { metrics } from "./routes/metrics";
import { notifications } from "./routes/notifications";
import { profiles } from "./routes/profiles";
import { time } from "./routes/time";
import { week } from "./routes/week";
import { work } from "./routes/work";
import { agent } from "./routes/agent";
import { slackEvents } from "./routes/slackEvents";
import { errorHandler } from "./util";

const app = express();

// Says less about what runs here, and stops a browser guessing a response's type.
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use(
  express.json({
    limit: "400kb",
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf.toString("utf8");
    },
  }),
);
/* Browsers reach this API through the web app's proxy, never directly, so no
   other origin needs to be allowed. Without WEB_ORIGIN the cors package would
   answer every origin with "*"; `false` sends no CORS headers at all. */
app.use(cors({ origin: process.env.WEB_ORIGIN || false, credentials: true }));

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
app.use(manictime);
app.use(interviews);
app.use(profiles);
app.use(contacts);
app.use(notifications);
app.use(work);
app.use(agent);
app.use(errorHandler);

export default app;
