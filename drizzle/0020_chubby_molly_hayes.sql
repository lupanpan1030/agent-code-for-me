ALTER TABLE `agent_jobs` ADD `provider_profile_id` text;--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `model_override` text;--> statement-breakpoint
ALTER TABLE `agent_schedules` ADD `provider_profile_id` text;--> statement-breakpoint
ALTER TABLE `agent_schedules` ADD `model_override` text;