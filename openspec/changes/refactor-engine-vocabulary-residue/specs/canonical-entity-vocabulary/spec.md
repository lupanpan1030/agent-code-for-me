## ADDED Requirements
### Requirement: Engine vocabulary has a single code-level identity source

Per the ratified D7 addendum (`docs/ideas/canonical-vocabulary.md` §8, 2026-08-25), a selectable
Claude Code/Codex runtime MUST be called "Engine" in UI copy and UI-layer selection code, its
API and persistence identity MUST remain `runtimeId`-shaped, and "Agent" MUST NOT name an
engine-selection surface. Engine id unions in code MUST derive from `CONTRACT_RUNTIME_IDS` in
`src/shared/agent-runtime-capabilities.ts` as the single source; a second independent engine-id
enum MUST NOT exist.

#### Scenario: Engine picker lists only live engines under Engine vocabulary

- **WHEN** the new-chat engine selection renders
- **THEN** it offers exactly the contract engines (Claude Code and Codex)
- **AND** no retired engine entry (such as a disabled Cursor CLI row) is listed
- **AND** the selection code names the concept Engine, not Agent

#### Scenario: Architecture guard rejects a second engine-id enum

- **WHEN** the architecture guard check runs
- **THEN** it fails if the shared chat vocabulary module declares an engine-id array literal
  independent of `CONTRACT_RUNTIME_IDS`
- **AND** the failure message names the canonical owner

#### Scenario: Persisted engine metadata key is stable

- **WHEN** chat message metadata is written or read
- **THEN** the persisted JSON key remains `provider` with unchanged runtime-id values
- **AND** engine inference from historical messages keeps working without migration
