#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const failures = []

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/")
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!existsSync(absolutePath)) {
    fail(`${relativePath} is missing.`)
    return ""
  }
  return readFileSync(absolutePath, "utf8")
}

function fail(message) {
  failures.push(message)
}

function assertIncludes(filePath, text, label) {
  const content = readText(filePath)
  if (!content.includes(text)) {
    fail(`${filePath} must include ${label}.`)
  }
}

function unwrapExpression(expression) {
  let current = expression
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function objectPropertyName(propertyName) {
  if (ts.isIdentifier(propertyName)) return propertyName.text
  if (ts.isStringLiteralLike(propertyName)) return propertyName.text
  if (ts.isNumericLiteral(propertyName)) return propertyName.text
  return null
}

function stringLiteralValue(expression) {
  const unwrapped = unwrapExpression(expression)
  if (!unwrapped) return null
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text
  if (ts.isNoSubstitutionTemplateLiteral(unwrapped)) return unwrapped.text
  return null
}

function parseI18nDictionaries(relativePath) {
  const content = readText(relativePath)
  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const entries = []
  const expectedDictionaryNames = new Set(["en", "zhCN"])
  const foundDictionaryNames = new Set()

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      expectedDictionaryNames.has(node.name.text)
    ) {
      foundDictionaryNames.add(node.name.text)
      const initializer = unwrapExpression(node.initializer)
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
        fail(
          `${relativePath} ${node.name.text} must be an object literal dictionary.`,
        )
        return
      }

      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) {
          continue
        }

        const key = objectPropertyName(property.name)
        const value = stringLiteralValue(property.initializer)
        if (key && value !== null) {
          entries.push({ locale: node.name.text, key, value })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  for (const name of expectedDictionaryNames) {
    if (!foundDictionaryNames.has(name)) {
      fail(`${relativePath} must export a ${name} dictionary.`)
    }
  }

  return entries
}

function dictionaryEntriesForKey(entries, key) {
  return entries.filter((entry) => entry.key === key)
}

function formatDictionaryEntry(entry) {
  return `${entry.locale}.${entry.key}`
}

function assertDictionaryContainsValue(entries, key, expectedValue) {
  const matchingEntries = dictionaryEntriesForKey(entries, key)
  if (!matchingEntries.some((entry) => entry.value === expectedValue)) {
    fail(
      `src/renderer/lib/i18n/dictionaries.ts must set ${key} to ${JSON.stringify(expectedValue)} in at least one locale.`,
    )
  }
}

function assertDictionaryValuesExclude(entries, forbiddenValues, label) {
  for (const entry of entries) {
    for (const forbiddenValue of forbiddenValues) {
      if (entry.value.includes(forbiddenValue)) {
        fail(
          `src/renderer/lib/i18n/dictionaries.ts ${formatDictionaryEntry(entry)} must not use retired ${label} vocabulary ${JSON.stringify(forbiddenValue)}.`,
        )
      }
    }
  }
}

function walkFiles(relativeDir, extensions, result = []) {
  const absoluteDir = path.join(repoRoot, relativeDir)
  if (!existsSync(absoluteDir)) return result

  for (const entry of readdirSync(absoluteDir)) {
    if (entry === "node_modules" || entry === "out" || entry === "dist") {
      continue
    }

    const absolutePath = path.join(absoluteDir, entry)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      walkFiles(relative(absolutePath), extensions, result)
      continue
    }

    if (extensions.some((extension) => entry.endsWith(extension))) {
      result.push(absolutePath)
    }
  }

  return result
}

const DANGEROUS_ROUTER_INPUT_FIELDS = new Set([
  "absolutePath",
  "baseUrl",
  "command",
  "cwd",
  "dirPath",
  "env",
  "filePath",
  "headers",
  "path",
  "projectPath",
  "token",
  "url",
])

const DANGEROUS_ROUTER_INPUT_ALLOWLIST = new Map([
  [
    "src/main/lib/trpc/routers/agent-builder.ts:list",
    {
      fields: ["cwd"],
      reason:
        "pre-existing agent-builder read path only lists registered agent-builder entries",
    },
  ],
  [
    "src/main/lib/trpc/routers/agent-runtime.ts:respondScopeExpansion",
    {
      fields: ["path"],
      reason:
        "pre-existing scope expansion response delegates path handling to the agent-guard owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/agent-runtime.ts:chat",
    {
      fields: ["cwd"],
      reason:
        "TICKET-104: renderer cwd is optional legacy input and verified against server-resolved chat cwd",
    },
  ],
  [
    "src/main/lib/trpc/routers/agents.ts:list",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project agents root resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/agents.ts:listEnabled",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project agents root resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/agents.ts:get",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project agent path resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/agents.ts:create",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project agent write resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/agents.ts:update",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project agent write resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/agents.ts:delete",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project agent delete resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude-code.ts:importToken",
    {
      fields: ["token"],
      reason:
        "pre-existing credential import stores token through the Claude Code auth owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude-provider-config.ts:save",
    {
      fields: ["baseUrl", "token"],
      reason:
        "TICKET-105: provider base URL and token are validated by provider-token helpers",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude-provider-config.ts:importLegacy",
    {
      fields: ["baseUrl", "token"],
      reason:
        "TICKET-105: provider base URL and token are validated by provider-token helpers",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:chat",
    {
      fields: ["cwd", "projectPath"],
      reason:
        "TICKET-104: runtime cwd is server-resolved; projectPath is only MCP lookup metadata",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:respondScopeExpansion",
    {
      fields: ["path"],
      reason:
        "pre-existing scope expansion response delegates path handling to the agent-guard owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:getMcpConfig",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: MCP project paths resolve through Runtime MCP Config owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:startMcpOAuth",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: MCP project paths resolve through Runtime MCP Config owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:getMcpAuthStatus",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: MCP project paths resolve through Runtime MCP Config owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:addMcpServer",
    {
      fields: ["projectPath", "command", "env", "url"],
      reason:
        "TICKET-105: MCP write inputs are validated by runtime-mcp-config input validation and registered roots",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:updateMcpServer",
    {
      fields: ["projectPath", "command", "env", "url"],
      reason:
        "TICKET-105: MCP write inputs are validated by runtime-mcp-config input validation and registered roots",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:removeMcpServer",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: project-scoped MCP mutations resolve registered project roots",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:setMcpBearerToken",
    {
      fields: ["projectPath", "token"],
      reason:
        "TICKET-105: bearer token writes stay inside Runtime MCP Config owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/claude.ts:getPendingPluginMcpApprovals",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: plugin MCP approvals read through Runtime MCP Config owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/codex.ts:addMcpServer",
    {
      fields: ["command", "url"],
      reason:
        "TICKET-105: Codex MCP write inputs are validated before CLI/config writes",
    },
  ],
  [
    "src/main/lib/trpc/routers/codex.ts:chat",
    {
      fields: ["cwd", "projectPath"],
      reason:
        "TICKET-104: runtime cwd is verified against server-resolved chat cwd",
    },
  ],
  [
    "src/main/lib/trpc/routers/codex.ts:startMcpOAuth",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: Codex MCP project cwd resolves through registered project roots",
    },
  ],
  [
    "src/main/lib/trpc/routers/codex.ts:logoutMcpServer",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: Codex MCP project cwd resolves through registered project roots",
    },
  ],
  [
    "src/main/lib/trpc/routers/commands.ts:list",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-102: project command root resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/commands.ts:getContent",
    {
      fields: ["path", "projectPath"],
      reason:
        "TICKET-102: command read path resolves through registered command component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/commands.ts:create",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-102: command write path resolves through registered command component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/commands.ts:update",
    {
      fields: ["path", "projectPath"],
      reason:
        "TICKET-102: command write path resolves through registered command component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/commands.ts:delete",
    {
      fields: ["path", "projectPath"],
      reason:
        "TICKET-102: command delete path resolves through registered command component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/external.ts:openInApp",
    {
      fields: ["path"],
      reason:
        "pre-existing external open boundary delegates to OS opener; Phase 3 will add capability consent",
    },
  ],
  [
    "src/main/lib/trpc/routers/external.ts:openFileInEditor",
    {
      fields: ["path", "cwd"],
      reason:
        "pre-existing editor-open boundary delegates to local editor launcher",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:search",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-101: file roots resolve through shared registered root resolver",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:clearCache",
    {
      fields: ["projectPath"],
      reason: "TICKET-101: file cache keys are scoped to registered file roots",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:readFile",
    {
      fields: ["filePath", "projectPath"],
      reason: "TICKET-101: file read path resolves inside registered file root",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:readTextFile",
    {
      fields: ["filePath", "projectPath"],
      reason: "TICKET-101: file read path resolves inside registered file root",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:readBinaryFile",
    {
      fields: ["filePath", "projectPath"],
      reason: "TICKET-101: file read path resolves inside registered file root",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:watchChanges",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-101: file watch roots resolve through shared registered root resolver",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:renameFile",
    {
      fields: ["projectPath", "absolutePath"],
      reason:
        "TICKET-101: file rename path resolves inside registered file root",
    },
  ],
  [
    "src/main/lib/trpc/routers/files.ts:deleteFile",
    {
      fields: ["projectPath", "absolutePath"],
      reason:
        "TICKET-101: file delete path resolves inside registered file root",
    },
  ],
  [
    "src/main/lib/trpc/routers/github-workflow.ts:importTaskFromUrl",
    {
      fields: ["url"],
      reason:
        "pre-existing network import validates GitHub task URL before workflow creation",
    },
  ],
  [
    "src/main/lib/trpc/routers/local-api-provider-config.ts:save",
    {
      fields: ["baseUrl", "token"],
      reason:
        "TICKET-105: provider base URL and token are validated by provider-token helpers",
    },
  ],
  [
    "src/main/lib/trpc/routers/mcp-registry.ts:install",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: registry install project scope resolves registered project roots and validates materialized MCP config",
    },
  ],
  [
    "src/main/lib/trpc/routers/mcp-registry.ts:checkInstalled",
    {
      fields: ["projectPath"],
      reason:
        "TICKET-105: registry check delegates project scope to runtime MCP owner",
    },
  ],
  [
    "src/main/lib/trpc/routers/projects.ts:create",
    {
      fields: ["path"],
      reason:
        "pre-existing project registration boundary canonicalizes selected project paths",
    },
  ],
  [
    "src/main/lib/trpc/routers/provider-profiles.ts:saveProfile",
    {
      fields: ["baseUrl", "token", "headers"],
      reason:
        "TICKET-105: provider URL, token, and safe metadata headers are normalized by provider profile storage",
    },
  ],
  [
    "src/main/lib/trpc/routers/skills.ts:list",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project skills root resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/skills.ts:create",
    {
      fields: ["cwd"],
      reason:
        "TICKET-102: project skill writes resolve through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/skills.ts:update",
    {
      fields: ["path", "cwd"],
      reason:
        "TICKET-102: skill update path resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/skills.ts:delete",
    {
      fields: ["path", "cwd"],
      reason:
        "TICKET-102: skill delete path resolves through registered project component root",
    },
  ],
  [
    "src/main/lib/trpc/routers/terminal.ts:listDirectory",
    {
      fields: ["dirPath"],
      reason:
        "TICKET-103: terminal directory listing resolves dirPath inside server-resolved chat root",
    },
  ],
])

const schemaFieldCache = new Map()

function schemaFieldsFromObjectLiteral(expression) {
  const object = unwrapExpression(expression)
  if (!object || !ts.isObjectLiteralExpression(object)) return null
  const fields = []
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = objectPropertyName(property.name)
    if (key) fields.push(key)
  }
  return fields
}

function uniqueFields(fields) {
  return [...new Set(fields)]
}

function resolveImportPath(fromFile, moduleSpecifier) {
  if (!moduleSpecifier.startsWith(".")) return null
  const base = path.resolve(
    path.dirname(path.join(repoRoot, fromFile)),
    moduleSpecifier,
  )
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) return relative(candidate)
  }
  return null
}

function buildSchemaContext(filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const variableInitializers = new Map()
  const importedSchemas = new Map()

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const importPath = resolveImportPath(filePath, node.moduleSpecifier.text)
      const bindings = node.importClause?.namedBindings
      if (importPath && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const localName = element.name.text
          const importedName = element.propertyName?.text ?? localName
          importedSchemas.set(localName, {
            filePath: importPath,
            name: importedName,
          })
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      variableInitializers.set(node.name.text, node.initializer)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  const context = {
    filePath,
    sourceFile,
    resolveIdentifier(name, seen = new Set()) {
      const localKey = `${filePath}:${name}`
      if (seen.has(localKey)) return null
      seen.add(localKey)

      const initializer = variableInitializers.get(name)
      if (initializer) {
        return schemaFieldsFromExpression(initializer, context, seen)
      }

      const imported = importedSchemas.get(name)
      if (imported) {
        return schemaFieldsForExport(imported.filePath, imported.name, seen)
      }

      return null
    },
  }

  return context
}

function schemaFieldsForExport(filePath, exportName, seen = new Set()) {
  const cacheKey = `${filePath}:${exportName}`
  if (schemaFieldCache.has(cacheKey)) return schemaFieldCache.get(cacheKey)

  const content = readText(filePath)
  const context = buildSchemaContext(filePath, content)
  const fields = context.resolveIdentifier(exportName, seen)
  schemaFieldCache.set(cacheKey, fields)
  return fields
}

function schemaFieldsFromExpression(expression, context, seen = new Set()) {
  const current = unwrapExpression(expression)
  if (!current) return null

  if (ts.isIdentifier(current)) {
    return context.resolveIdentifier(current.text, seen)
  }

  if (!ts.isCallExpression(current)) return null

  const callee = unwrapExpression(current.expression)
  if (!callee || !ts.isPropertyAccessExpression(callee)) return null

  const methodName = callee.name.text
  if (
    methodName === "object" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "z"
  ) {
    return schemaFieldsFromObjectLiteral(current.arguments[0])
  }

  if (methodName === "extend") {
    const baseFields = schemaFieldsFromExpression(
      callee.expression,
      context,
      seen,
    )
    const extensionFields = schemaFieldsFromObjectLiteral(current.arguments[0])
    if (!baseFields && !extensionFields) return null
    return uniqueFields([...(baseFields ?? []), ...(extensionFields ?? [])])
  }

  const transparentSchemaMethods = new Set([
    "array",
    "catch",
    "default",
    "describe",
    "nullable",
    "optional",
    "passthrough",
    "refine",
    "strict",
    "superRefine",
    "transform",
  ])
  if (transparentSchemaMethods.has(methodName)) {
    return schemaFieldsFromExpression(callee.expression, context, seen)
  }

  return null
}

function procedureNameForInputCall(node) {
  let current = node
  while (current?.parent) {
    if (
      ts.isPropertyAssignment(current.parent) &&
      current.parent.initializer === current
    ) {
      return objectPropertyName(current.parent.name)
    }
    current = current.parent
  }
  return null
}

function collectDangerousRouterInputFindings(filePath, content) {
  const context = buildSchemaContext(filePath, content)
  const findings = []

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "input"
    ) {
      const procedureName = procedureNameForInputCall(node)
      const fields =
        schemaFieldsFromExpression(node.arguments[0], context) ?? []
      const dangerousFields = fields.filter((field) =>
        DANGEROUS_ROUTER_INPUT_FIELDS.has(field),
      )
      if (procedureName && dangerousFields.length > 0) {
        findings.push({
          key: `${filePath}:${procedureName}`,
          filePath,
          procedureName,
          fields: uniqueFields(dangerousFields),
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(context.sourceFile)
  return findings
}

function assertDangerousRouterInputGuardSelfTest() {
  const fixturePath = "src/main/lib/trpc/routers/__architecture_fixture__.ts"
  const findings = collectDangerousRouterInputFindings(
    fixturePath,
    `
      import { z } from "zod"
      export const fixtureRouter = router({
        unsafe: publicProcedure
          .input(z.object({ cwd: z.string() }))
          .query(() => null),
      })
    `,
  )
  if (
    !findings.some(
      (finding) =>
        finding.key === `${fixturePath}:unsafe` &&
        finding.fields.includes("cwd"),
    )
  ) {
    fail(
      "Dangerous router input guard self-test must detect a fixture cwd input.",
    )
  }
}

function assertNoUnresolvedDangerousRouterInput() {
  assertDangerousRouterInputGuardSelfTest()
  const routerFiles = walkFiles("src/main/lib/trpc/routers", [".ts"])
    .map(relative)
    .filter((filePath) => filePath !== "src/main/lib/trpc/routers/index.ts")

  for (const filePath of routerFiles) {
    const findings = collectDangerousRouterInputFindings(
      filePath,
      readText(filePath),
    )

    for (const finding of findings) {
      const allowed = DANGEROUS_ROUTER_INPUT_ALLOWLIST.get(finding.key)
      if (!allowed) {
        fail(
          `${finding.key} declares dangerous input field(s) ${finding.fields.join(", ")} without an approved resolver allowlist entry.`,
        )
        continue
      }

      const allowedFields = new Set(allowed.fields)
      const unexpectedFields = finding.fields.filter(
        (field) => !allowedFields.has(field),
      )
      if (unexpectedFields.length > 0) {
        fail(
          `${finding.key} declares new dangerous input field(s) ${unexpectedFields.join(", ")} beyond its allowlist (${allowed.reason}).`,
        )
      }
    }
  }
}

function assertPackageScripts() {
  const packageJson = JSON.parse(readText("package.json"))
  const scripts = packageJson.scripts ?? {}
  if (
    scripts["architecture:check"] !==
    "node scripts/check-architecture-guards.mjs"
  ) {
    fail(
      "package.json scripts.architecture:check must run scripts/check-architecture-guards.mjs.",
    )
  }
  if (!String(scripts.check ?? "").includes("bun run architecture:check")) {
    fail("package.json scripts.check must include bun run architecture:check.")
  }
}

function assertCiRunsArchitectureCheck() {
  const ci = readText(".github/workflows/ci.yml")
  if (!/\brun:\s*bun run architecture:check\b/.test(ci)) {
    fail("GitHub CI must run bun run architecture:check.")
  }
}

function assertOwnershipDocs() {
  const requiredSections = [
    "## Runtime Capability Truth",
    "## Runtime Chat UI Event State",
    "## Renderer Chat Message Model And Hydration",
    "## Guard Decisions",
    "## Provider Credentials",
    "## Claude Desktop Chat Runtime",
    "## Codex Desktop Chat Runtime",
    "## Headless Agent Runtime",
    "## Runtime MCP Configuration",
    "## tRPC Route Boundary",
  ]

  const ownershipMap = readText("docs/OWNERSHIP_MAP.md")
  for (const section of requiredSections) {
    if (!ownershipMap.includes(section)) {
      fail(`docs/OWNERSHIP_MAP.md must include ${section}.`)
    }
  }

  assertIncludes(
    "AGENTS.md",
    "This project does not allow old/new duplicate business paths.",
    "the no-double-path rule",
  )
  assertIncludes(
    "AGENTS.md",
    "docs/OWNERSHIP_MAP.md",
    "the ownership map reference",
  )
}

function assertRuntimeCapabilitySingleOwner() {
  const owner = "src/shared/agent-runtime-capabilities.ts"
  const sourceFiles = walkFiles("src", [".ts", ".tsx"])

  for (const absolutePath of sourceFiles) {
    const filePath = relative(absolutePath)
    const content = readFileSync(absolutePath, "utf8")
    if (
      filePath !== owner &&
      /\b(?:export\s+)?const\s+AGENT_RUNTIME_CAPABILITY_IDS\s*=/.test(content)
    ) {
      fail(
        `Runtime capability ID definitions belong only in ${owner}, not ${filePath}.`,
      )
    }
    if (filePath !== owner && /\bcapability\(\s*\{/.test(content)) {
      fail(
        `Runtime capability manifest entries belong only in ${owner}, not ${filePath}.`,
      )
    }
  }

  const codexFacade = readText("src/shared/codex-runtime-capabilities.ts")
  if (!codexFacade.includes('from "./agent-runtime-capabilities"')) {
    fail(
      "src/shared/codex-runtime-capabilities.ts must import capability truth from agent-runtime-capabilities.",
    )
  }
  if (/\bcapability\(\s*\{/.test(codexFacade)) {
    fail(
      "src/shared/codex-runtime-capabilities.ts must remain a facade, not a second capability manifest.",
    )
  }
}

function assertGuardDecisionSingleOwner() {
  const owner = "src/main/lib/agent-guard/decision.ts"
  const sourceFiles = walkFiles("src", [".ts", ".tsx"])
  const exports = []

  for (const absolutePath of sourceFiles) {
    const filePath = relative(absolutePath)
    const content = readFileSync(absolutePath, "utf8")
    if (/\bexport\s+function\s+decideClaudeToolUse\b/.test(content)) {
      exports.push(filePath)
    }
    if (
      filePath !== owner &&
      /\bfunction\s+decide[A-Za-z]*ToolUse\b/.test(content)
    ) {
      fail(`Guarded tool-use decisions belong in ${owner}, not ${filePath}.`)
    }
  }

  if (exports.length !== 1 || exports[0] !== owner) {
    fail(
      `decideClaudeToolUse must be exported only from ${owner}; found ${exports.join(", ") || "none"}.`,
    )
  }
}

function assertRuntimeEventStateOwner() {
  const owner = "src/renderer/features/agents/lib/runtime-event-state.ts"
  const transportDir = "src/renderer/features/agents/lib"
  const ownerOnlyAtoms = [
    "askUserQuestionResultsAtom",
    "expiredUserQuestionsAtom",
    "guardedRunAuditsAtom",
    "guardedRunEventsAtom",
    "pendingScopeExpansionRequestsAtom",
    "pendingUserQuestionsAtom",
  ]

  readText(owner)

  for (const absolutePath of walkFiles(transportDir, [".ts", ".tsx"])) {
    const filePath = relative(absolutePath)
    if (filePath === owner) {
      continue
    }

    const content = readFileSync(absolutePath, "utf8")
    for (const atomName of ownerOnlyAtoms) {
      if (content.includes(atomName)) {
        fail(`${atomName} mutations belong in ${owner}, not ${filePath}.`)
      }
    }
  }
}

function assertChatMessageModelOwner() {
  const normalizerOwner = "src/shared/chat-message-normalizer.ts"
  const removedShim = "src/renderer/lib/mock-api.ts"
  const sourceFiles = walkFiles("src", [".ts", ".tsx"])
  const normalizerExportFiles = []

  if (existsSync(path.join(repoRoot, removedShim))) {
    fail(
      `${removedShim} must not exist; renderer chat data must use agent-chat-api plus the shared normalizer.`,
    )
  }

  for (const absolutePath of sourceFiles) {
    const filePath = relative(absolutePath)
    const content = readFileSync(absolutePath, "utf8")

    if (/from\s+["'][^"']*mock-api["']/.test(content)) {
      fail(`${filePath} must not import the removed mock-api shim.`)
    }

    if (
      /\bexport\s+(?:function|const)\s+normalizePersistedChatMessages\b/.test(
        content,
      )
    ) {
      normalizerExportFiles.push(filePath)
    }
  }

  if (
    normalizerExportFiles.length !== 1 ||
    normalizerExportFiles[0] !== normalizerOwner
  ) {
    fail(
      `normalizePersistedChatMessages must be exported only from ${normalizerOwner}; found ${normalizerExportFiles.join(", ") || "none"}.`,
    )
  }

  const adapter = readText("src/renderer/features/agents/lib/agent-chat-api.ts")
  if (!adapter.includes('from "../../../../shared/chat-message-normalizer"')) {
    fail(
      "agent-chat-api must hydrate persisted messages through src/shared/chat-message-normalizer.ts.",
    )
  }
}

function assertNoDeadSettingsState() {
  const atomsFile = "src/renderer/lib/atoms/index.ts"
  const atomsContent = readText(atomsFile)

  // Atoms defined in the settings/atoms source, and the persisted subset.
  const defRegex =
    /export\s+const\s+(\w+)\s*=\s*(?:atomWithStorage|atomFamily|atom)\b/g
  const defMatches = [...atomsContent.matchAll(defRegex)]
  const definedAtoms = defMatches.map((m) => m[1])
  const persistedAtoms = [
    ...atomsContent.matchAll(/export\s+const\s+(\w+)\s*=\s*atomWithStorage\b/g),
  ].map((m) => m[1])

  // Text of every source file except the atoms definition file, for detecting
  // references that live outside atoms/index.ts (a real consumer).
  const externalText = walkFiles("src", [".ts", ".tsx"])
    .filter((p) => relative(p) !== atomsFile)
    .map((p) => readFileSync(p, "utf8"))
    .join("\n")
  const wordRegex = (name) => new RegExp(`\\b${name}\\b`)

  // Liveness: seed with atoms referenced outside atoms/index.ts, then propagate
  // consumer -> producer (a live derived atom's body keeps the atoms it reads
  // alive) so a setting read only through a live derived atom is not flagged.
  const bodyByName = new Map()
  for (let i = 0; i < defMatches.length; i++) {
    const start = defMatches[i].index
    const end =
      i + 1 < defMatches.length ? defMatches[i + 1].index : atomsContent.length
    bodyByName.set(defMatches[i][1], atomsContent.slice(start, end))
  }
  const live = new Set(
    definedAtoms.filter((name) => wordRegex(name).test(externalText)),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const liveName of [...live]) {
      const body = bodyByName.get(liveName)
      if (!body) continue
      for (const name of definedAtoms) {
        if (!live.has(name) && wordRegex(name).test(body)) {
          live.add(name)
          changed = true
        }
      }
    }
  }

  for (const name of persistedAtoms) {
    if (!live.has(name)) {
      fail(
        `Persisted settings atom ${name} in ${atomsFile} has no reader (dead settings state); wire a reader/control or remove it.`,
      )
    }
  }

  // Every settings tab module must be reached by the settings content switcher.
  // Match by module path (not exported symbol), so same-file aliases such as
  // AgentsProjectWorktreeTab / AgentsProjectsTab are not false positives.
  const switcher = readText(
    "src/renderer/features/settings/settings-content.tsx",
  )
  const tabModules = walkFiles(
    "src/renderer/components/dialogs/settings-tabs",
    [".tsx"],
  )
    .map(relative)
    .filter((p) => /agents-[\w-]+-tab\.tsx$/.test(p))
  for (const tabModule of tabModules) {
    const moduleName = path.basename(tabModule, ".tsx")
    if (!switcher.includes(`settings-tabs/${moduleName}`)) {
      fail(
        `Settings tab module ${tabModule} is never rendered by settings-content.tsx (unrendered tab); render it or remove it.`,
      )
    }
  }
}

function assertCanonicalVocabularyI18n() {
  const dictionaryEntries = parseI18nDictionaries(
    "src/renderer/lib/i18n/dictionaries.ts",
  )

  const expectedValues = [
    ["sidebar.newChat", "New Quick chat"],
    ["sidebar.newChat", "新建快速对话"],
    ["sidebar.startNewChat", "Start a Quick chat"],
    ["sidebar.startNewChat", "开始快速对话"],
    ["settings.keyboard.actions.newWorkspace", "New Workspace"],
    ["settings.keyboard.actions.newWorkspace", "新建工作区"],
    ["quickChat.attachFolder", "Attach a Project"],
    ["quickChat.attachFolder", "关联项目"],
    ["sidebar.openRepository", "Open a Project"],
    ["sidebar.openRepository", "打开项目"],
    ["chat.selectRepo", "Select Project"],
    ["chat.selectRepo", "选择项目"],
    ["onboarding.repo.selectTitle", "Open a Project"],
    ["onboarding.repo.selectTitle", "打开项目"],
    ["onboarding.repo.skip", "Start a Quick chat"],
    ["onboarding.repo.skip", "开始快速对话"],
    ["agent.project.addRepository", "Open a Project"],
    ["agent.project.addRepository", "打开项目"],
    ["settings.models.subChatTitle.title", "Chat Title API"],
    ["settings.models.subChatTitle.title", "对话标题 API"],
    ["settings.debug.chats", "Workspaces"],
    ["settings.debug.chats", "工作区"],
    ["settings.debug.subChats", "Chats"],
    ["settings.debug.subChats", "对话"],
    ["settings.sidebar.agents", "Agent Builder"],
    ["settings.sidebar.agents", "智能体构建器"],
  ]

  for (const [key, expectedValue] of expectedValues) {
    assertDictionaryContainsValue(dictionaryEntries, key, expectedValue)
  }

  const retiredChatTerms = ["sub-chat", "Sub-chat", "subchat", "子对话"]
  // Scan every dictionary value, not just today's known Chat labels. This keeps
  // future keys from quietly reintroducing retired user-facing vocabulary.
  assertDictionaryValuesExclude(dictionaryEntries, retiredChatTerms, "Chat")

  const retiredAgentTerms = [
    "Custom Agents",
    "App Agent",
    "App Agents",
    "应用智能体",
  ]
  assertDictionaryValuesExclude(dictionaryEntries, retiredAgentTerms, "Agent")
}

assertOwnershipDocs()
assertPackageScripts()
assertCiRunsArchitectureCheck()
assertRuntimeCapabilitySingleOwner()
assertGuardDecisionSingleOwner()
assertRuntimeEventStateOwner()
assertChatMessageModelOwner()
assertNoUnresolvedDangerousRouterInput()
assertNoDeadSettingsState()
assertCanonicalVocabularyI18n()

if (failures.length > 0) {
  console.error("Architecture guard failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("Architecture guard passed.")
