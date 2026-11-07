export type Role = "admin" | "manager" | "member";
export type Status = "draft" | "submitted" | "approved" | "returned";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  team_id: number | null;
  active: boolean;
  job_title?: string;
  bio?: string;
  avatar?: string | null;
  /** Bidders are assignable to profiles but excluded from weekly metrics. */
  is_bidder?: boolean;
}
export interface Team {
  id: number;
  name: string;
}
export interface Period {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
  locked: boolean;
}
export interface Entry {
  metric_id: number;
  planned: number;
  done: number;
  bonus: number;
  note: string | null;
  updated_at?: string;
}
export type FormulaType = "ratio" | "count" | "overtime";
export const TIME_TRACKING_KEY = "time_tracking";
export const isTimeTracking = (m: { key: string }) => m.key === TIME_TRACKING_KEY;
export interface Metric {
  id: number;
  key: string;
  name: string;
  formula_type: FormulaType;
  weight: number;
  cap: number;
  target: number;
  overtime_rate: number;
  unit: string;
  team_id: number | null;
  team_name?: string | null;
  active: boolean;
}
export interface MetricScore {
  metric_id: number;
  key: string;
  name: string;
  formula_type: FormulaType;
  weight: number;
  planned: number;
  done: number;
  bonus: number;
  ratio: number | null;
  base: number;
  contribution: number;
  na: boolean;
  part?: "base" | "bonus";
}
export interface Score {
  total: number;
  base: number;
  bonus: number;
  achievement_pct: number | null;
  breakdown: MetricScore[];
}
export interface WeekReport {
  id?: number;
  status: Status;
  summary: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  bonus: number;
}
export interface WeekData {
  week_start: string;
  week_end: string;
  today: string;
  user: { id: number; name: string; email: string; team_id: number | null; avatar?: string | null };
  status: Status;
  report: WeekReport | null;
  editable: boolean;
  metrics: Metric[];
  days: string[];
  daily: Record<number, Record<string, number>>;
  day_points: number[];
  time_hours: number;
  score: Score;
}
export interface TeamWeekRow {
  user_id: number;
  name: string;
  email: string;
  avatar?: string | null;
  role: Role;
  status: Status;
  report_id: number | null;
  has_data: boolean;
  total: number;
  bonus: number;
  achievement_pct: number | null;
  day_points: number[];
  team_id: number | null;
  team_name: string | null;
  metric_points: {
    id: number;
    name: string;
    points: number;
    planned?: number;
    done?: number;
    ratio?: number | null;
    weight?: number;
    formula_type?: FormulaType;
    unit?: string;
  }[];
}
export interface QueueItem {
  report_id: number;
  user_id: number;
  name: string;
  email: string;
  avatar?: string | null;
  week_start: string;
  week_end: string;
  summary: string | null;
  submitted_at: string;
  score: Score;
}
export interface HistoryPoint {
  week_start: string;
  label: string;
  total: number;
  achievement_pct: number | null;
  status: Status;
}
export interface TimeLog {
  id: number;
  log_date: string;
  minutes: number;
  task: string;
  note: string | null;
}
export interface TimeTeamWeek {
  week_start: string;
  week_end: string;
  today: string;
  days: string[];
  rows: { user_id: number; name: string; email: string; avatar?: string | null; minutes: number; by_day: number[] }[];
}
export interface TimeWeek {
  week_start: string;
  week_end: string;
  today: string;
  days: string[];
  logs: TimeLog[];
  by_day: number[];
  total_minutes: number;
}
/** What a calendar event is. Future metrics group on this. */
export type InterviewKind = "interview" | "ai_interview" | "event";

/** A scheduled meeting between one of our profiles and an outside client. */
export interface Interview {
  id: number;
  /** The profile being interviewed. Null on rows from the old internal 1:1. */
  profile_id: number | null;
  profile_name: string | null;
  profile_email: string | null;
  /** The client side. They have no account here, so this is plain text. */
  client_name: string;
  client_email: string;
  /** Null for a profile-and-client interview; set on old internal 1:1 rows. */
  member_id: number | null;
  /** Whoever booked it. */
  interviewer_id: number;
  scheduled_at: string;
  /** Null on rows predating end times. */
  ends_at: string | null;
  all_day: boolean;
  /** Room or meeting link. "" when none was given. */
  location: string;
  topic: string;
  /* What the event is. Kept as its own field rather than read out of the
     topic text, because metrics will group by it. */
  kind: InterviewKind;
  status: "scheduled" | "done" | "passed" | "failed" | "cancelled";
  notes: string | null;
  member_name: string | null;
  member_email: string | null;
  member_avatar?: string | null;
  interviewer_name: string;
  interviewer_email: string;
  interviewer_avatar?: string | null;
}
export interface Profile {
  id: number;
  email: string;
  name: string;
  role: Role;
  team_id: number | null;
  team_name: string | null;
  job_title: string;
  bio: string;
  avatar: string | null;
}
export interface AuditRow {
  id: number;
  at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor: string | null;
}
export interface SlackStatus {
  connected: boolean;
  slack_user_id: string | null;
  slack_team_id: string | null;
  connected_at: string | null;
  openai_configured: boolean;
}
export interface SlackInstallStatus {
  installed: boolean;
  installer_linked?: boolean;
  slack_oauth: boolean;
  client_id: string;
  has_secret: boolean;
  has_signing_secret: boolean;
  has_app_token: boolean;
  openai_configured: boolean;
  workspaces: { slack_team_id: string; bot_user_id: string | null; installed_at: string }[];
  redirect_uri: string;
  events_url: string;
}
export interface AgentConversation {
  id: number;
  title: string;
  source: string;
  slack_channel_id?: string | null;
  slack_thread_ts?: string | null;
  updated_at: string;
  messages?: AgentChatMessage[];
}
export interface AgentChatMessage {
  id?: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name?: string | null;
}
export interface AuditPage {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

/* ---------- profiles and AI training (migration 015) ---------- */

export type TrainingStatus = "created" | "applied" | "approved" | "ongoing" | "rejected";

export interface ProfileAssignee {
  user_id: number;
  name: string;
  email: string;
  avatar: string | null;
}
export interface TrainingAccount {
  id: number;
  site_id: number;
  site_name: string;
  status: TrainingStatus;
  account_email: string;
  note: string;
  updated_at: string;
}
export interface TeamProfile {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  linkedin_url: string;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  /* What the profile is used for. A profile is usually both; one not marked
     for AI training is left off that board entirely. */
  for_job: boolean;
  for_ai_training: boolean;
  assignees: ProfileAssignee[];
  accounts: TrainingAccount[];
  /** The bidder working this profile, if one is assigned. */
  bidder_id: number | null;
  bidder: ProfileAssignee | null;
  bidder_status: BidderStatus;
}
/** How far the assigned bidder has got. Unrelated to training statuses. */
export type BidderStatus = "none" | "assigned" | "bidding";
export interface TrainingSite {
  id: number;
  name: string;
  url: string;
  /** Pulled from the site's own page by POST /training-sites/fetch. May be "". */
  summary: string;
  /** Absolute URL of the site's icon, or "" if none was found. */
  icon_url: string;
  active: boolean;
  sort_order: number;
}
/** What the site's own page reports about itself. Nothing is saved yet. */
export interface SiteMetaPreview {
  name: string;
  summary: string;
  icon_url: string;
  url: string;
}
/** Rows are sites, columns are profiles. */
export interface TrainingMatrix {
  sites: { id: number; name: string; url: string; summary: string; icon_url: string }[];
  /** Profiles used for AI training, with who they are assigned to. */
  profiles: { id: number; full_name: string; assignees: ProfileAssignee[] }[];
  accounts: {
    id: number;
    profile_id: number;
    site_id: number;
    status: TrainingStatus;
    account_email: string;
    note: string;
    updated_at: string;
  }[];
}
/** Assignee picker list: every active user, ids and names only. */
export interface ProfilePerson {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  /** Bidders are assignable but left out of all weekly metrics views. */
  is_bidder: boolean;
}
