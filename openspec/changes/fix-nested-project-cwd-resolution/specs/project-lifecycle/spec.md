## ADDED Requirements

### Requirement: Registered CWD Resolution Uses The Most Specific Eligible Project

The shared project registry owner SHALL resolve an implicit cwd that is inside
more than one eligible explicitly registered canonical project root to the
matching project whose canonical root is most specific. Specificity SHALL be
determined only after the existing eligibility and path-boundary checks. This
selection SHALL NOT make any cwd eligible that is outside all explicitly
registered roots, and an explicitly supplied project identity SHALL retain its
existing authoritative validation semantics.

#### Scenario: Nested active registrations select the deepest root

- **WHEN** outer, middle, and deepest nested canonical project roots are all
  explicitly registered and eligible
- **AND** an implicit cwd is inside all three roots
- **THEN** the shared registry owner resolves the cwd to the deepest matching
  canonical project root
- **AND** the result does not depend on registration or database row order

#### Scenario: A longer unrelated root is not a candidate

- **WHEN** a registered canonical root has a longer path but does not contain the
  requested cwd
- **THEN** that root does not participate in specificity selection
- **AND** a cwd outside every eligible explicitly registered root remains
  unregistered

#### Scenario: Explicit project identity keeps its existing meaning

- **WHEN** a caller explicitly supplies an outer registered project identity for
  a cwd inside that outer root
- **AND** a more deeply nested project is also registered
- **THEN** the registry validates and returns the explicitly supplied outer
  project under the existing rules
- **AND** it does not silently replace the caller's explicit identity with the
  nested project

#### Scenario: No Git metadata admission is introduced

- **WHEN** implicit cwd registration is resolved by this requirement
- **THEN** candidate projects consist only of eligible explicitly registered
  canonical roots that contain the cwd
- **AND** target-directory `.git`, `gitdir`, `commondir`, remote, or worktree
  metadata is not used to add a candidate
