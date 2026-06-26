CREATE TABLE `mcp_command_trust_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime` text NOT NULL,
	`server_name` text NOT NULL,
	`scope` text NOT NULL,
	`command_hash` text NOT NULL,
	`decision` text DEFAULT 'approved' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_command_trust_hash_idx` ON `mcp_command_trust_decisions` (`command_hash`);--> statement-breakpoint
CREATE INDEX `mcp_command_trust_runtime_server_idx` ON `mcp_command_trust_decisions` (`runtime`,`server_name`);