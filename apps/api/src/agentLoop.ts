import { openaiKeyFor, slackApiTokenFor } from "./slackTokens";
import { addDays, todayUtc, weekStartOf } from "./dates";
import { pool } from "./db";
import { isTimeTracking } from "./scoring";
import type { User } from "./types";
import { audit } from "./util";
import { getReport, weekSnapshot } from "./week";

const tools = [
  {
    type: "function" as const,
    function: {
      name: "eval_get_my_week",
      description: "Get this Huddle user's weekly metrics, status, and score. Weeks are Sunday–Saturday UTC.",
      parameters: { type: "object", properties: { week_start: { type: "string", description: "YYYY-MM-DD Sunday" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "eval_list_metrics",
      description: "List active metrics this user reports on.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "eval_write_daily",
      description: "Write one daily metric value for this user. Call first with confirm=false to preview, then confirm=true after they agree.",
      parameters: {
        type: "object",
        properties: {
          metric_id: { type: "number" },
          entry_date: { type: "string" },
          value: { type: "number" },
          confirm: { type: "boolean" },
        },
        required: ["metric_id", "entry_date", "value", "confirm"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "slack_search",
      description: "Search Slack messages the workspace bot can see (needs search:read on a user token, otherwise may fail).",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "slack_fetch_messages",
      description: "Fetch recent messages from a Slack channel the Huddle bot is in. channel is a Slack channel ID (C… or D…), not a #name.",
      parameters: {
        type: "object",
        properties: { channel: { type: "string" }, limit: { type: "number" } },
        required: ["channel"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "slack_post_message",
      description: "Post a message as the Huddle Slack bot. Use only when they asked you to send it. Preview with confirm=false first.",
      parameters: {
        type: "object",
        properties: { channel: { type: "string" }, text: { type: "string" }, confirm: { type: "boolean" } },
        required: ["channel", "text", "confirm"],
      },
    },
  },
];

type OaiMessage = { role: string; content?: string | null; tool_calls?: unknown; name?: string; tool_call_id?: string };

async function slackApi(token: string, method: string, params: Record<string, string>) {
  const q = new URLSearchParams(params);
  const res = await fetch(`https://slack.com/api/${method}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
}

async function runTool(user: User, name: string, raw: string): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ error: "Invalid tool arguments" });
  }

  if (name === "eval_list_metrics") {
    const snap = await weekSnapshot(user, weekStartOf(todayUtc()));
    return JSON.stringify(
      snap.metrics.map((m) => ({ id: m.id, name: m.name, unit: m.unit, formula_type: m.formula_type, target: m.target })),
    );
  }

  if (name === "eval_get_my_week") {
    const ws = weekStartOf(typeof args.week_start === "string" ? args.week_start : todayUtc());
    const snap = await weekSnapshot(user, ws);
    return JSON.stringify({
      week_start: ws,
      week_end: addDays(ws, 6),
      status: snap.report?.status ?? "draft",
      total: snap.score.total,
      achievement_pct: snap.score.achievement_pct,
      time_hours: snap.time_hours,
      metrics: snap.score.breakdown.map((b) => ({ name: b.name, done: b.done, planned: b.planned, points: b.contribution })),
    });
  }

  if (name === "eval_write_daily") {
    const metricId = Number(args.metric_id);
    const entryDate = String(args.entry_date ?? "");
    const value = Number(args.value);
    const confirm = Boolean(args.confirm);
    if (!metricId || !entryDate || Number.isNaN(value)) return JSON.stringify({ error: "Need metric_id, entry_date, value" });
    const snap = await weekSnapshot(user, weekStartOf(entryDate));
    const metric = snap.metrics.find((m) => m.id === metricId);
    if (!metric) return JSON.stringify({ error: "Metric not found" });
    if (!confirm) {
      return JSON.stringify({ preview: true, metric: metric.name, entry_date: entryDate, value, hint: "Ask the user to confirm, then call again with confirm=true" });
    }
    if (entryDate > addDays(todayUtc(), 1)) return JSON.stringify({ error: "Cannot enter a future day" });
    const report = await getReport(user.id, weekStartOf(entryDate));
    if (report && (report.status === "submitted" || report.status === "approved")) {
      return JSON.stringify({ error: `Week is ${report.status}, entries are locked` });
    }
    if (isTimeTracking(metric)) return JSON.stringify({ error: "Time tracking comes from ManicTime active time and can't be entered by hand" });
    if (value <= 0) {
      await pool.query("delete from daily_entries where user_id=$1 and metric_id=$2 and entry_date=$3", [user.id, metricId, entryDate]);
    } else {
      await pool.query(
        `insert into daily_entries (user_id, metric_id, entry_date, value) values ($1,$2,$3,$4)
         on conflict (user_id, metric_id, entry_date) do update set value = excluded.value, updated_at = now()`,
        [user.id, metricId, entryDate, value],
      );
    }
    await audit(user.id, "agent_write_daily", "metric", metricId, { entry_date: entryDate, value });
    return JSON.stringify({ ok: true, metric: metric.name, entry_date: entryDate, value });
  }

  const token = await slackApiTokenFor(user.id);
  if (!token) return JSON.stringify({ error: "An admin needs to Connect to Slack under Admin → Agent connect." });

  if (name === "slack_search") {
    const query = String(args.query ?? "").slice(0, 200);
    const r = await slackApi(token, "search.messages", { query, count: "10" });
    if (!r.ok) return JSON.stringify({ error: r.error ?? "search failed" });
    const matches = ((r.messages as { matches?: { text?: string; username?: string; channel?: { name?: string } }[] })?.matches ?? []).slice(0, 10);
    return JSON.stringify(
      matches.map((m) => ({ channel: m.channel?.name, user: m.username, text: (m.text ?? "").slice(0, 400) })),
    );
  }

  if (name === "slack_fetch_messages") {
    const channel = String(args.channel ?? "");
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 20));
    const r = await slackApi(token, "conversations.history", { channel, limit: String(limit) });
    if (!r.ok) return JSON.stringify({ error: r.error ?? "history failed" });
    const msgs = (r.messages as { text?: string; user?: string }[] | undefined) ?? [];
    return JSON.stringify(msgs.slice(0, limit).map((m) => ({ user: m.user, text: (m.text ?? "").slice(0, 400) })));
  }

  if (name === "slack_post_message") {
    const channel = String(args.channel ?? "");
    const text = String(args.text ?? "").slice(0, 3000);
    if (!Boolean(args.confirm)) {
      return JSON.stringify({ preview: true, channel, text, hint: "Confirm with the user, then call again with confirm=true" });
    }
    const r = await slackApi(token, "chat.postMessage", { channel, text });
    if (!r.ok) return JSON.stringify({ error: r.error ?? "post failed" });
    await audit(user.id, "agent_slack_post", "slack", channel, {});
    return JSON.stringify({ ok: true, channel });
  }

  return JSON.stringify({ error: `Unknown tool ${name}` });
}

export async function runAgentTurn(
  user: User,
  history: { role: string; content: string }[],
  onEvent: (event: string, data: unknown) => void,
): Promise<string> {
  const key = (await openaiKeyFor(user.id)) || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("An admin needs to add an OpenAI API key under Admin → Agent connect");

  const system = `You are the personal Huddle agent for ${user.name || user.email} (Huddle user ${user.id}, role ${user.role}, team_id ${user.team_id}).
Weeks run Sunday–Saturday UTC. Today is ${todayUtc()}.
Use tools for facts. Do not invent metric numbers.
Preview eval_write_daily and slack_post_message with confirm=false until the user clearly agrees.
Slack DMs, @mentions, and tools use the workspace bot an admin installed. Members do not add Slack tokens. If Slack tools fail, say an admin must Connect to Slack under Admin → Agent connect.
Keep answers concise.`;

  const messages: OaiMessage[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role === "tool" ? "assistant" : m.role, content: m.content })),
  ];

  for (let i = 0; i < 8; i++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        tools,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices: { message: OaiMessage }[];
    };
    const msg = json.choices[0]?.message;
    if (!msg) throw new Error("Empty OpenAI response");
    const calls = msg.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined;
    if (!calls?.length) {
      const text = String(msg.content ?? "").trim() || "I have nothing to add.";
      onEvent("token", { text });
      return text;
    }
    messages.push(msg);
    for (const c of calls) {
      onEvent("tool", { name: c.function.name });
      const result = await runTool(user, c.function.name, c.function.arguments);
      messages.push({ role: "tool", tool_call_id: c.id, content: result });
    }
  }
  return "I hit the tool limit. Try a more specific question.";
}
