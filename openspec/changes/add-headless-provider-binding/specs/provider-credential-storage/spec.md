## ADDED Requirements

### Requirement: Provider Credential Input and Stored-Value Validation

Provider credential owners SHALL reject destinations containing URL userinfo, query parameters, or fragments and SHALL accept non-empty credentials only when they meet the exact-secret redaction floor. Profile, legacy Claude, and local-helper destination metadata reads SHALL fail closed for unsafe persisted URLs. Runtime credential reads and credential-preserving updates SHALL decrypt and validate stored credential data at the authoritative main-process read boundary and SHALL fail closed when that data is invalid or unavailable. Renderer metadata MAY report ciphertext presence as `hasToken` solely to preserve an edit-form placeholder. Main SHALL separately report `credentialUsable` only after successful decrypt-and-normalize validation, and renderer connection/readiness state SHALL use that authoritative receipt rather than `hasToken`.

#### Scenario: Unsafe destination or short credential is saved

- **WHEN** a provider destination contains a URL username or password, including percent-encoded userinfo, or contains query parameters or a fragment
- **OR** a supplied provider credential is shorter than the exact-secret redaction floor
- **THEN** the canonical provider input owner rejects the save without persisting the value

#### Scenario: Stored provider destination violates the input boundary

- **WHEN** a profile, legacy Claude, or local-helper row contains a destination with URL userinfo, query parameters, or a fragment
- **THEN** metadata and runtime reads fail closed
- **AND** the unsafe destination is not returned to the renderer or passed to a runtime

#### Scenario: Stored provider ciphertext is not a readiness signal

- **WHEN** a persisted row contains credential ciphertext that is unreadable or decrypts to an invalid credential
- **THEN** renderer metadata may report `hasToken: true` solely because ciphertext is present, for an edit-form placeholder
- **AND** main reports `credentialUsable: false`
- **AND** renderer connected, configured, usable, and ready state remains false
- **AND** `hasToken` cannot override a failed authoritative runtime read
- **AND** the authoritative runtime read fails closed

#### Scenario: Credential-preserving update encounters an invalid stored value

- **WHEN** an update omits a replacement credential but the existing ciphertext cannot be decrypted and validated
- **THEN** the update refuses to preserve the invalid value
- **AND** the user is required to provide a valid replacement credential
