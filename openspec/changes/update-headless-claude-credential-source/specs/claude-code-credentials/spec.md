## ADDED Requirements

### Requirement: Credential Source Parity Across Execution Surfaces

The app-managed Anthropic account store SHALL be the primary Claude credential source for every Locus-managed Claude execution surface (desktop chat and headless jobs alike), so that one desktop sign-in authorizes all surfaces. Surfaces MAY fall back to the bundled CLI's local login when no app-stored credential is usable, and no surface SHALL require the user to authenticate the same account twice through different stores.

#### Scenario: Desktop sign-in authorizes headless runs

- **WHEN** a user connects an Anthropic account through the Locus desktop app
- **AND** later starts a headless Claude job on the same machine
- **THEN** the headless run authenticates from the same app-stored credential without an additional CLI login

#### Scenario: CLI-only login keeps working

- **WHEN** a machine has a `claude` CLI login but no app-stored account
- **THEN** headless Claude runs continue to authenticate through the CLI's local login
- **AND** desktop onboarding may offer to import that login into the app store, as it does today
