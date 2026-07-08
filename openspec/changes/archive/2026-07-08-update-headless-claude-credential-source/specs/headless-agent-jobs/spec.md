## ADDED Requirements

### Requirement: Headless Claude Credential Resolution

Headless Claude runs SHALL resolve authentication from the app-managed Anthropic account store first and SHALL fall back to the bundled CLI's local login only when no usable app-stored credential exists. Credential material MUST enter the runtime through the child process environment only and MUST NOT appear in CLI arguments, job events, or structured output.

#### Scenario: App-stored account authenticates a headless run

- **WHEN** a headless Claude job starts on a machine whose Locus app has a connected Anthropic account
- **THEN** the adapter resolves the account token in the main process and injects it into the runtime child environment
- **AND** the run authenticates without requiring a separate `claude` CLI login
- **AND** provider env variables stripped by the shared Claude env builder remain stripped

#### Scenario: No app account falls back to CLI login

- **WHEN** a headless Claude job starts and no app-stored Anthropic account exists
- **THEN** the adapter starts the runtime without injecting a token
- **AND** the bundled CLI resolves its own local login as it does today

#### Scenario: Inherited env token is ignored

- **WHEN** a headless Claude job starts with `CLAUDE_CODE_OAUTH_TOKEN` inherited from the parent environment
- **AND** no app-stored token is injected for the run
- **THEN** the adapter removes the inherited token from the child runtime environment
- **AND** emits a stderr diagnostic that names Locus desktop sign-in and `claude` CLI login as the supported credential sources

#### Scenario: Unhealthy app store does not break a working CLI login

- **WHEN** an app-stored credential exists but cannot be resolved (secure storage unavailable or token refresh fails)
- **THEN** the adapter emits a stderr diagnostic and falls back to the bundled CLI's local login
- **AND** the job does not fail solely because the app store is unhealthy

#### Scenario: No credential in either source

- **WHEN** a headless Claude job starts with no app-stored account and no CLI login
- **THEN** the run fails with the `runtime_auth_required` error code and the missing-credentials exit code
- **AND** the diagnostic hint names both remedies: signing in through the Locus desktop app or logging in with the `claude` CLI
