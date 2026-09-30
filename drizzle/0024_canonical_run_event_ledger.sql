CREATE TABLE `agent_job_projection_cursors` (
	`job_id` text NOT NULL,
	`projection_name` text NOT NULL,
	`acknowledged_sequence` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`job_id`, `projection_name`),
	FOREIGN KEY (`job_id`) REFERENCES `agent_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_job_projection_cursors_acknowledged_sequence_check" CHECK("agent_job_projection_cursors"."acknowledged_sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE `agent_job_events` ADD `fact_key` text;--> statement-breakpoint
ALTER TABLE `agent_job_events` ADD `record_metadata_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_job_events_job_fact_key_idx` ON `agent_job_events` (`job_id`,`fact_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_job_events_v1_completed_idx` ON `agent_job_events` (`job_id`) WHERE "agent_job_events"."type" = 'completed' AND "agent_job_events"."fact_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `ledger_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `ledger_provenance_json` text;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `ledger_sealed_sequence` integer;--> statement-breakpoint
-- Every pre-existing job is pre-ledger history: label it ledger_version=0
-- (legacy_unverified) without rewriting any event bytes, IDs or sequences.
-- New jobs keep the column default of 1.
UPDATE `agent_jobs` SET `ledger_version` = 0;
