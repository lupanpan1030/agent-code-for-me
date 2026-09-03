## MODIFIED Requirements

### Requirement: Local Preview Boundary

The system SHALL load only main-admitted local top-level targets in the Local
Browser Workbench. Each HTTP(S) preview admission SHALL fix the exact normalized
origin, including port; a user who chooses another local origin starts a new
preview admission rather than letting the current page cross origins. An
admitted file target SHALL load only through the registered-root preview broker,
never as direct guest `file://` content. This boundary governs top-level
navigation; it does not claim to block page-controlled fetch, form, WebSocket,
image/ping, frame, or other subresource egress to remote or other loopback
services.

#### Scenario: User opens a localhost page

- **WHEN** the user enters `localhost`, `127.0.0.1`, `[::1]`, or an allowed
  `file://` URL
- **THEN** the workbench normalizes the URL and main issues a new bounded
  preview admission
- **AND** it loads HTTP(S) at the exact admitted origin or file content through
  the main-owned registered-root broker

#### Scenario: User enters a remote URL

- **WHEN** the user enters a non-local HTTP or HTTPS URL
- **THEN** the workbench blocks navigation
- **AND** displays a clear local-only reason

#### Scenario: Preview attempts remote navigation

- **WHEN** the loaded page attempts top-level navigation to a remote target or
  another local origin/port without a new user-entered admission
- **THEN** the main-owned request gate prevents the navigation before commit
- **AND** records only a minimized/redacted blocked-origin diagnostic

#### Scenario: User deliberately opens another local origin

- **WHEN** the user enters a valid local URL whose origin differs from the
  active preview
- **THEN** main creates a new preview generation, one-shot admission, and unique
  non-persistent partition
- **AND** the workbench destroys the old guest rather than letting its page
  carry storage or navigation authority into the new origin

#### Scenario: Safe file broker is unavailable

- **WHEN** the current platform or filesystem cannot prove the approved
  descriptor-anchored, no-follow safe-read primitive for an otherwise allowed
  file preview
- **THEN** the workbench SHALL reject or disable that file preview and display
  a clear bounded reason
- **AND** it SHALL NOT fall back to direct guest `file://` loading or a
  containment-check-then-path-open flow
