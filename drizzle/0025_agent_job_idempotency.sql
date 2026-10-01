CREATE TABLE `agent_job_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`job_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`normalization_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `agent_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_job_idempotency_consumer_key_idx` ON `agent_job_idempotency` (`consumer_id`,`key_hash`);--> statement-breakpoint
CREATE INDEX `agent_job_idempotency_job_id_idx` ON `agent_job_idempotency` (`job_id`);--> statement-breakpoint
CREATE INDEX `agent_job_idempotency_expires_at_idx` ON `agent_job_idempotency` (`expires_at`);