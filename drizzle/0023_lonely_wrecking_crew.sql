CREATE TABLE `sub_chat_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_chat_id` text NOT NULL,
	`runtime` text NOT NULL,
	`provider_profile_id` text,
	`model_id` text,
	`model_source` text,
	`thinking_level` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sub_chat_bindings_sub_chat_idx` ON `sub_chat_bindings` (`sub_chat_id`);