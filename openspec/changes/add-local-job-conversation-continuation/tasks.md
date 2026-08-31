## 1. Handle storage and lineage

- [ ] 1.1 Add continuation mapping storage plus nullable continuation lineage on jobs.
- [ ] 1.2 Add mint, resolve, and revoke helpers without serializing native session references.
- [ ] 1.3 Cover unknown, revoked, expired, runtime, project, and cwd binding failures.

## 2. Runtime session preservation

- [ ] 2.1 Capture Claude and Codex native session references through the runtime observer/result boundary.
- [ ] 2.2 Preserve sessions only for continuable runs and map verified resumes to each native runtime.
- [ ] 2.3 Fail with a structured diagnostic when a runtime cannot honor a resolved resume.
- [ ] 2.4 Redact native session references from argv diagnostics, events, artifacts, renderer state, and logs.

## 3. API contract and CLI

- [ ] 3.1 Accept `continuable` and `continuation.handle` in the v1 request schema.
- [ ] 3.2 Add matching `runs create` CLI arguments and feature advertisement.
- [ ] 3.3 Resolve the handle before job creation and reject binding failures without starting provider work.
- [ ] 3.4 Return `continuationHandle` only when a verified mapping exists.
- [ ] 3.5 Surface continuation lineage separately from retry lineage.

## 4. Verification

- [ ] 4.1 Cover create, terminal handle retrieval, and continued create as separate durable jobs.
- [ ] 4.2 Assert that a fake runtime receives the verified native resume reference.
- [ ] 4.3 Assert fail-closed binding behavior and zero provider starts on preflight rejection.
- [ ] 4.4 Assert native session references never reach observable or persisted consumer surfaces.
- [ ] 4.5 Assert requests without continuation fields retain current behavior.
- [ ] 4.6 Run OpenSpec validation, focused tests, TypeScript checks, architecture guards, and build.
