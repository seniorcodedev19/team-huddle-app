-- Which daily work number, if any, fills a weekly metric.
--
-- The weekly report's fields fill themselves from the daily work typed on
-- the profiles a person is assigned to. The link has to be stored rather
-- than guessed: these metrics' keys predate what they now measure
-- ("code_reviews" is Job Apply), and a name can be changed at any time.
--
-- Null means the metric is typed by hand, as before.

alter table metrics add column if not exists work_source text;

alter table metrics drop constraint if exists metrics_work_source_check;
alter table metrics add constraint metrics_work_source_check check (
  work_source is null
  or work_source in ('apply', 'interview_scheduled', 'interview_done', 'ai_apply', 'ai_interview', 'assessment')
);

-- The four metrics that match a daily number today, by key, which does not
-- change when a metric is renamed. Only set where still empty, so a link an
-- admin changes later is not reset if this file is ever re-run.
update metrics set work_source = 'apply'               where key = 'code_reviews'         and work_source is null;
update metrics set work_source = 'interview_scheduled' where key = 'bugs_fixed'           and work_source is null;
update metrics set work_source = 'interview_done'      where key = 'docs_shared'          and work_source is null;
update metrics set work_source = 'assessment'          where key = 'take_assessment_9fbe' and work_source is null;
