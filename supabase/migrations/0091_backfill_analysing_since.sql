-- Give the rows that were already stuck a start time, so they can be recovered.
--
-- 0090 added analysing_since and the tracker treats NULL as "unknown, assume the
-- review is still running". That default is deliberate — it means the takeover
-- rule can only ever unwedge a pull request and can never steal one that is
-- genuinely in flight — but it has an obvious consequence: every row written
-- before 0090 has NULL, so the pull requests that were ALREADY wedged by a
-- restart are exactly the ones the fix cannot reach. They would spin forever.
--
-- updated_at is the best evidence available for those rows. It is the wrong
-- signal to READ continuously (it carries a touch trigger, so recording a
-- pending head refreshes it and a dead review would look alive for as long as
-- anyone kept pushing) but it is a fine one to seed from ONCE: for a row that is
-- stuck, nothing has touched it since the push that got swallowed.
--
-- Safe for a review that is genuinely running right now:
--   - dispatched by the NEW code  → analysing_since is already set, so the
--     `is null` guard skips it entirely
--   - dispatched by the OLD code  → updated_at is its dispatch time, so it is
--     seeded as recent, reads as alive, and is left alone until it ages out
--
-- One-off by nature. After this, every row gets its start time at dispatch.
update tracker.pull_request_analyses
   set analysing_since = updated_at
 where status = 'analysing'
   and analysing_since is null;
