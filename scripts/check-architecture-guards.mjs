#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { load as parseYaml } from "js-yaml"
import ts from "typescript"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const failures = []
const updateArchitectureBaselines = process.argv.includes(
  "--update-architecture-baselines",
)
const ARCHITECTURE_BASELINE_PATH = "scripts/architecture-baselines.json"
const OWNERSHIP_MAP_PATH = "docs/OWNERSHIP_MAP.md"
const CI_DIFF_BASE_SHA_EXPRESSION = [
  "$",
  "{{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
].join("")

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
      ts.isNonNullExpression(current) ||
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

const RUNTIME_CORE_DIRECTORIES = [
  "src/main/lib/agent-runtime",
  "src/main/lib/headless",
  "src/main/lib/agent-guard",
  "src/main/lib/provider-profiles",
  "src/main/lib/model-catalog",
  "src/main/lib/codex",
  "src/main/lib/claude",
  "src/main/lib/runtime-mcp-config",
  "src/main/lib/runtime-capability-projection",
  "src/main/lib/agent-workbench",
]
const RUNTIME_CORE_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]
const RUNTIME_CORE_OWNERSHIP_SECTION =
  'docs/OWNERSHIP_MAP.md "Runtime Core Import Boundary"'

function isPathInside(absolutePath, absoluteDirectory) {
  const relativePath = path.relative(absoluteDirectory, absolutePath)
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  )
}

function resolveLocalImport(filePath, specifier) {
  const target = specifier.replace(/[?#].*$/, "")
  if (target.startsWith(".")) {
    return path.resolve(repoRoot, path.dirname(filePath), target)
  }
  if (target.startsWith("src/")) {
    return path.resolve(repoRoot, target)
  }
  if (path.isAbsolute(target)) {
    return path.resolve(target)
  }
  return null
}

function runtimeCoreImportCategory(filePath, specifier) {
  if (specifier === "electron" || specifier.startsWith("electron/")) {
    return "Electron"
  }

  if (
    specifier === "@trpc" ||
    specifier.startsWith("@trpc/") ||
    specifier === "trpc-electron" ||
    specifier.startsWith("trpc-electron/")
  ) {
    return "tRPC"
  }

  if (specifier.startsWith("@/")) {
    return "renderer"
  }

  const resolvedTarget = resolveLocalImport(filePath, specifier)
  if (!resolvedTarget) return null

  const bannedResolvedDirectories = [
    ["tRPC", path.join(repoRoot, "src/main/lib/trpc")],
    ["renderer", path.join(repoRoot, "src/renderer")],
    ["preload", path.join(repoRoot, "src/preload")],
  ]
  for (const [category, absoluteDirectory] of bannedResolvedDirectories) {
    if (isPathInside(resolvedTarget, absoluteDirectory)) {
      return category
    }
  }

  return null
}

function importTypeSpecifier(node) {
  const argument = node.argument
  if (!ts.isLiteralTypeNode(argument)) return null
  return stringLiteralValue(argument.literal)
}

function memberExpression(expression) {
  const unwrapped = unwrapExpression(expression)
  if (!unwrapped) return null

  if (ts.isPropertyAccessExpression(unwrapped)) {
    return {
      object: unwrapExpression(unwrapped.expression),
      property: unwrapped.name.text,
    }
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    return {
      object: unwrapExpression(unwrapped.expression),
      property: stringLiteralValue(unwrapped.argumentExpression),
    }
  }

  return null
}

function isModuleRequireExpression(expression) {
  const member = memberExpression(expression)
  return (
    member?.property === "require" &&
    ts.isIdentifier(member.object) &&
    member.object.text === "module"
  )
}

function isCreateRequireFactoryExpression(
  expression,
  createRequireFactories,
  moduleNamespaces,
) {
  const unwrapped = unwrapExpression(expression)
  if (!unwrapped) return false

  if (
    ts.isIdentifier(unwrapped) &&
    createRequireFactories.has(unwrapped.text)
  ) {
    return true
  }

  const member = memberExpression(unwrapped)
  return (
    member?.property === "createRequire" &&
    ts.isIdentifier(member.object) &&
    moduleNamespaces.has(member.object.text)
  )
}

function collectRuntimeCoreLoaderBindings(sourceFile) {
  const loaderAliases = new Map([["require", "require call"]])
  const createRequireFactories = new Set()
  const moduleNamespaces = new Set()
  const variableDeclarations = []

  function collect(node) {
    if (
      ts.isImportDeclaration(node) &&
      ["module", "node:module"].includes(
        stringLiteralValue(node.moduleSpecifier),
      ) &&
      node.importClause
    ) {
      if (node.importClause.name) {
        moduleNamespaces.add(node.importClause.name.text)
      }

      const bindings = node.importClause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        moduleNamespaces.add(bindings.name.text)
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text
          if (importedName === "createRequire") {
            createRequireFactories.add(element.name.text)
          }
        }
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      variableDeclarations.push(node)
    }

    ts.forEachChild(node, collect)
  }

  collect(sourceFile)

  let changed = true
  while (changed) {
    changed = false

    for (const declaration of variableDeclarations) {
      const name = declaration.name.text
      const initializer = unwrapExpression(declaration.initializer)
      if (!initializer) continue

      if (
        ts.isIdentifier(initializer) &&
        createRequireFactories.has(initializer.text) &&
        !createRequireFactories.has(name)
      ) {
        createRequireFactories.add(name)
        changed = true
      } else if (
        isCreateRequireFactoryExpression(
          initializer,
          createRequireFactories,
          moduleNamespaces,
        ) &&
        !createRequireFactories.has(name)
      ) {
        createRequireFactories.add(name)
        changed = true
      }

      let loaderSyntax = null
      if (ts.isIdentifier(initializer) && loaderAliases.has(initializer.text)) {
        loaderSyntax = "require alias call"
      } else if (isModuleRequireExpression(initializer)) {
        loaderSyntax = "module.require alias call"
      } else if (
        ts.isCallExpression(initializer) &&
        isCreateRequireFactoryExpression(
          initializer.expression,
          createRequireFactories,
          moduleNamespaces,
        )
      ) {
        loaderSyntax = "createRequire alias call"
      }

      if (loaderSyntax && !loaderAliases.has(name)) {
        loaderAliases.set(name, loaderSyntax)
        changed = true
      }
    }
  }

  return { createRequireFactories, loaderAliases, moduleNamespaces }
}

function runtimeCoreLoaderCallSyntax(expression, loaderBindings) {
  const callee = unwrapExpression(expression)
  if (!callee) return null

  if (
    ts.isIdentifier(callee) &&
    loaderBindings.loaderAliases.has(callee.text)
  ) {
    return loaderBindings.loaderAliases.get(callee.text)
  }

  if (isModuleRequireExpression(callee)) {
    return "module.require call"
  }

  if (
    ts.isCallExpression(callee) &&
    isCreateRequireFactoryExpression(
      callee.expression,
      loaderBindings.createRequireFactories,
      loaderBindings.moduleNamespaces,
    )
  ) {
    return "createRequire call"
  }

  return null
}

function collectDependencyReferences(filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const findings = []
  const loaderBindings = collectRuntimeCoreLoaderBindings(sourceFile)

  function addFinding(specifier, syntax) {
    if (specifier === null) return
    findings.push({ filePath, specifier, syntax })
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const syntax = node.importClause?.isTypeOnly
        ? "type-only import declaration"
        : node.importClause
          ? "import declaration"
          : "side-effect import declaration"
      addFinding(stringLiteralValue(node.moduleSpecifier), syntax)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      addFinding(
        stringLiteralValue(node.moduleSpecifier),
        node.isTypeOnly
          ? "type-only export-from declaration"
          : "export-from declaration",
      )
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addFinding(stringLiteralValue(node.arguments[0]), "dynamic import")
    } else if (ts.isCallExpression(node)) {
      const syntax = runtimeCoreLoaderCallSyntax(
        node.expression,
        loaderBindings,
      )
      if (syntax) {
        addFinding(stringLiteralValue(node.arguments[0]), syntax)
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addFinding(
        stringLiteralValue(node.moduleReference.expression),
        "import-equals declaration",
      )
    } else if (ts.isImportTypeNode(node)) {
      addFinding(importTypeSpecifier(node), "import type node")
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

function collectRuntimeCoreImportBoundaryFindings(filePath, content) {
  return collectDependencyReferences(filePath, content).flatMap((finding) => {
    const category = runtimeCoreImportCategory(
      finding.filePath,
      finding.specifier,
    )
    return category ? [{ ...finding, category }] : []
  })
}

function assertRuntimeCoreImportBoundarySelfTest() {
  const fixtures = [
    {
      name: "expanded Codex directory Electron import",
      filePath: "src/main/lib/codex/__architecture_boundary_fixture__.ts",
      content: 'import { app } from "electron"',
      expected: {
        specifier: "electron",
        syntax: "import declaration",
        category: "Electron",
      },
    },
    {
      name: "side-effect Electron import",
      filePath:
        "src/main/lib/agent-runtime/__architecture_boundary_fixture__.ts",
      content: 'import "electron/main"',
      expected: {
        specifier: "electron/main",
        syntax: "side-effect import declaration",
        category: "Electron",
      },
    },
    {
      name: "type-only external tRPC import",
      filePath: "src/main/lib/headless/__architecture_boundary_fixture__.tsx",
      content: 'import type { AnyRouter } from "@trpc/server"',
      expected: {
        specifier: "@trpc/server",
        syntax: "type-only import declaration",
        category: "tRPC",
      },
    },
    {
      name: "inline type external tRPC import",
      filePath: "src/main/lib/headless/__architecture_boundary_fixture__.cjs",
      content: 'import { type TRPCError } from "@trpc/server"',
      expected: {
        specifier: "@trpc/server",
        syntax: "import declaration",
        category: "tRPC",
      },
    },
    {
      name: "internal tRPC import",
      filePath:
        "src/main/lib/provider-profiles/__architecture_boundary_fixture__.mts",
      content:
        'import { appRouter } from "../trpc/routers/index"; void appRouter',
      expected: {
        specifier: "../trpc/routers/index",
        syntax: "import declaration",
        category: "tRPC",
      },
    },
    {
      name: "tRPC export-from",
      filePath:
        "src/main/lib/agent-guard/__architecture_boundary_fixture__.cts",
      content: 'export { createIPCHandler } from "trpc-electron/main"',
      expected: {
        specifier: "trpc-electron/main",
        syntax: "export-from declaration",
        category: "tRPC",
      },
    },
    {
      name: "dynamic renderer import",
      filePath:
        "src/main/lib/agent-runtime/__architecture_boundary_fixture__.js",
      content: 'void import("../../../renderer/lib/atoms")',
      expected: {
        specifier: "../../../renderer/lib/atoms",
        syntax: "dynamic import",
        category: "renderer",
      },
    },
    {
      name: "preload require",
      filePath: "src/main/lib/headless/__architecture_boundary_fixture__.jsx",
      content: 'require("../../../preload/index")',
      expected: {
        specifier: "../../../preload/index",
        syntax: "require call",
        category: "preload",
      },
    },
    {
      name: "parenthesized require",
      filePath:
        "src/main/lib/agent-runtime/__architecture_boundary_fixture__.js",
      content: '(require)("electron")',
      expected: {
        specifier: "electron",
        syntax: "require call",
        category: "Electron",
      },
    },
    {
      name: "module.require",
      filePath:
        "src/main/lib/provider-profiles/__architecture_boundary_fixture__.cjs",
      content: 'module.require("@trpc/server")',
      expected: {
        specifier: "@trpc/server",
        syntax: "module.require call",
        category: "tRPC",
      },
    },
    {
      name: "module.require alias",
      filePath:
        "src/main/lib/provider-profiles/__architecture_boundary_fixture__.cjs",
      content: 'const load = module["require"]; load("trpc-electron/main")',
      expected: {
        specifier: "trpc-electron/main",
        syntax: "module.require alias call",
        category: "tRPC",
      },
    },
    {
      name: "require alias chain",
      filePath: "src/main/lib/agent-guard/__architecture_boundary_fixture__.ts",
      content:
        'const load = require; const loadAgain = load; loadAgain("@/features/agents")',
      expected: {
        specifier: "@/features/agents",
        syntax: "require alias call",
        category: "renderer",
      },
    },
    {
      name: "createRequire alias",
      filePath: "src/main/lib/headless/__architecture_boundary_fixture__.mts",
      content:
        'import { createRequire as makeRequire } from "node:module"; const load = makeRequire(import.meta.url); load("../../../preload/index")',
      expected: {
        specifier: "../../../preload/index",
        syntax: "createRequire alias call",
        category: "preload",
      },
    },
    {
      name: "inline createRequire",
      filePath:
        "src/main/lib/agent-runtime/__architecture_boundary_fixture__.mjs",
      content:
        'import * as nodeModule from "node:module"; nodeModule.createRequire(import.meta.url)("electron/main")',
      expected: {
        specifier: "electron/main",
        syntax: "createRequire call",
        category: "Electron",
      },
    },
    {
      name: "Electron import-equals",
      filePath:
        "src/main/lib/provider-profiles/__architecture_boundary_fixture__.ts",
      content: 'import electron = require("electron")',
      expected: {
        specifier: "electron",
        syntax: "import-equals declaration",
        category: "Electron",
      },
    },
    {
      name: "renderer import type node",
      filePath: "src/main/lib/agent-guard/__architecture_boundary_fixture__.ts",
      content:
        'type RendererStore = import("../../../renderer/lib/store").Store',
      expected: {
        specifier: "../../../renderer/lib/store",
        syntax: "import type node",
        category: "renderer",
      },
    },
    {
      name: "renderer alias",
      filePath:
        "src/main/lib/agent-runtime/__architecture_boundary_fixture__.mjs",
      content: 'export * from "@/features/agents"',
      expected: {
        specifier: "@/features/agents",
        syntax: "export-from declaration",
        category: "renderer",
      },
    },
  ]

  for (const fixture of fixtures) {
    const findings = collectRuntimeCoreImportBoundaryFindings(
      fixture.filePath,
      fixture.content,
    )
    if (
      findings.length !== 1 ||
      findings[0].specifier !== fixture.expected.specifier ||
      findings[0].syntax !== fixture.expected.syntax ||
      findings[0].category !== fixture.expected.category
    ) {
      fail(
        `Runtime Core Import Boundary self-test must detect ${fixture.name}; found ${
          findings
            .map(
              (finding) =>
                `${finding.syntax} ${JSON.stringify(finding.specifier)} (${finding.category})`,
            )
            .join(", ") || "nothing"
        }.`,
      )
    }
  }

  const cleanFixturePath =
    "src/main/lib/headless/__architecture_boundary_clean_fixture__.cjs"
  const cleanFindings = collectRuntimeCoreImportBoundaryFindings(
    cleanFixturePath,
    `
      import "./runtime-route-catalog"
      const packageName = "electron"
      const example = 'import type { AnyRouter } from "@trpc/server"'
      const anotherExample = "require('trpc-electron')"
      // import "../../../renderer/index"
      /* require("../../../preload/index") */
      void packageName
      void example
      void anotherExample
    `,
  )
  if (cleanFindings.length > 0) {
    fail(
      `Runtime Core Import Boundary self-test must ignore clean imports, comments, and ordinary strings; found ${cleanFindings
        .map((finding) => JSON.stringify(finding.specifier))
        .join(", ")}.`,
    )
  }
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodePoints)
}

function findingKey(finding, fields) {
  return fields.map((field) => finding[field]).join("\u0000")
}

function sortFindings(findings, fields) {
  const byKey = new Map()
  for (const finding of findings) {
    byKey.set(findingKey(finding, fields), finding)
  }
  return [...byKey.values()].sort((left, right) =>
    compareCodePoints(findingKey(left, fields), findingKey(right, fields)),
  )
}

function collectCurrentImportBoundaryViolations() {
  const findings = []
  for (const runtimeCoreDirectory of RUNTIME_CORE_DIRECTORIES) {
    for (const absolutePath of walkFiles(
      runtimeCoreDirectory,
      RUNTIME_CORE_SOURCE_EXTENSIONS,
    )) {
      const filePath = relative(absolutePath)
      const content = readFileSync(absolutePath, "utf8")
      findings.push(
        ...collectRuntimeCoreImportBoundaryFindings(filePath, content).map(
          ({ category, specifier }) => ({
            file: filePath,
            specifier,
            category,
          }),
        ),
      )
    }
  }
  return sortFindings(findings, ["file", "specifier", "category"])
}

function collectReverseDirectionImportFindings(filePath, content) {
  const routerDirectory = path.join(repoRoot, "src/main/lib/trpc/routers")
  return collectDependencyReferences(filePath, content).flatMap((finding) => {
    const resolvedTarget = resolveLocalImport(filePath, finding.specifier)
    return resolvedTarget && isPathInside(resolvedTarget, routerDirectory)
      ? [{ file: filePath, specifier: finding.specifier }]
      : []
  })
}

function collectCurrentReverseDirectionImports() {
  const findings = []
  for (const absolutePath of walkFiles(
    "src/main/lib",
    RUNTIME_CORE_SOURCE_EXTENSIONS,
  )) {
    const filePath = relative(absolutePath)
    if (filePath.startsWith("src/main/lib/trpc/")) continue
    findings.push(
      ...collectReverseDirectionImportFindings(
        filePath,
        readFileSync(absolutePath, "utf8"),
      ),
    )
  }
  return sortFindings(findings, ["file", "specifier"])
}

function collectBindingNames(name, result) {
  if (ts.isIdentifier(name)) {
    result.add(name.text)
    return
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element))
        collectBindingNames(element.name, result)
    }
  }
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind))
}

function collectNamedExports(filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const exports = new Set()

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        exports.add("*")
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exports.add(element.name.text)
        }
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        exports.add(statement.exportClause.name.text)
      }
      continue
    }

    if (
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      continue
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, exports)
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement)) &&
      statement.name
    ) {
      exports.add(statement.name.text)
    }
  }

  return [...exports].sort(compareCodePoints)
}

function countNewlines(content) {
  return content.split("\n").length - 1
}

const ROUTE_SURFACE_TARGETS = [
  {
    file: "src/main/lib/trpc/routers/claude.ts",
    governance: "temporary-owner containment",
    retirement:
      "retire only with the approved extraction that removes the Claude temporary-owner clause",
  },
  {
    file: "src/main/lib/trpc/routers/codex.ts",
    governance: "orchestration-boundary no-growth containment",
    retirement:
      "retire only by explicit Owner decision or in the same approved structural-decomposition change (for example Job Kernel)",
  },
]

function measureRouteSurfaces() {
  return Object.fromEntries(
    ROUTE_SURFACE_TARGETS.map(({ file }) => {
      const content = readText(file)
      return [
        file,
        {
          lines: countNewlines(content),
          exports: collectNamedExports(file, content),
        },
      ]
    }),
  )
}

function routeSurfaceMessages(file, measured, baseline, target) {
  const messages = []
  const note = baseline.raiseNote
    ? ` Recorded raiseNote: ${baseline.raiseNote}`
    : ""
  if (measured.lines > baseline.lines) {
    messages.push(
      `${file} ${target.governance} grew to ${measured.lines} lines (baseline ${baseline.lines}). ${target.retirement}; a baseline raise is Red and requires an explicit Owner-approved guard/spec change plus the recorded baseline edit.${note}`,
    )
  } else if (measured.lines < baseline.lines) {
    messages.push(
      `${file} ${target.governance} shrank to ${measured.lines} lines (baseline ${baseline.lines}); tighten routeSurfaceRatchets.${JSON.stringify(file)}.lines to ${measured.lines}.`,
    )
  }

  const baselineExports = new Set(baseline.exports)
  const measuredExports = new Set(measured.exports)
  const added = measured.exports.filter((name) => !baselineExports.has(name))
  const removed = baseline.exports.filter((name) => !measuredExports.has(name))
  if (added.length > 0) {
    messages.push(
      `${file} ${target.governance} added named export(s) ${added.join(", ")} outside its ratchet; ${target.retirement}.${note}`,
    )
  }
  if (removed.length > 0) {
    messages.push(
      `${file} removed named export(s) ${removed.join(", ")}; tighten routeSurfaceRatchets.${JSON.stringify(file)}.exports to ${JSON.stringify(measured.exports)}.`,
    )
  }
  return messages
}

function resolveSourceModuleFile(filePath, specifier) {
  const unresolved = resolveLocalImport(filePath, specifier)
  if (!unresolved) return null

  const extension = path.extname(unresolved)
  const bases = [unresolved]
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    bases.push(unresolved.slice(0, -extension.length))
  }
  const candidates = []
  for (const base of bases) {
    candidates.push(base)
    for (const sourceExtension of RUNTIME_CORE_SOURCE_EXTENSIONS) {
      candidates.push(`${base}${sourceExtension}`)
      candidates.push(path.join(base, `index${sourceExtension}`))
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function wrapperRegistryName(absolutePath) {
  const libDirectory = path.join(repoRoot, "src/main/lib")
  if (!isPathInside(absolutePath, repoRoot)) return null
  const repositoryPath = relative(absolutePath)
  let name = isPathInside(absolutePath, libDirectory)
    ? repositoryPath.slice("src/main/lib/".length)
    : repositoryPath
  for (const extension of RUNTIME_CORE_SOURCE_EXTENSIONS) {
    if (name.endsWith(extension)) {
      name = name.slice(0, -extension.length)
      break
    }
  }
  if (name.endsWith("/index")) name = name.slice(0, -"/index".length)
  return name
}

function reachThroughFindingForResolvedModule(
  importerFile,
  specifier,
  resolvedModule,
  moduleContent,
) {
  const guardedDirectories = RUNTIME_CORE_DIRECTORIES.map((directory) =>
    path.join(repoRoot, directory),
  )
  if (
    guardedDirectories.some((directory) =>
      isPathInside(resolvedModule, directory),
    )
  ) {
    return null
  }

  const wrapper = wrapperRegistryName(resolvedModule)
  if (!wrapper) return null
  const bannedImports = collectRuntimeCoreImportBoundaryFindings(
    relative(resolvedModule),
    moduleContent,
  )
  if (bannedImports.length === 0) return null
  return {
    importer: importerFile,
    specifier,
    wrapper,
    categories: sortedUnique(bannedImports.map((finding) => finding.category)),
  }
}

function collectCurrentReachThroughFindings() {
  const findings = []
  for (const runtimeCoreDirectory of RUNTIME_CORE_DIRECTORIES) {
    for (const absolutePath of walkFiles(
      runtimeCoreDirectory,
      RUNTIME_CORE_SOURCE_EXTENSIONS,
    )) {
      const importerFile = relative(absolutePath)
      const importerContent = readFileSync(absolutePath, "utf8")
      for (const dependency of collectDependencyReferences(
        importerFile,
        importerContent,
      )) {
        if (runtimeCoreImportCategory(importerFile, dependency.specifier)) {
          continue
        }
        const resolvedModule = resolveSourceModuleFile(
          importerFile,
          dependency.specifier,
        )
        if (!resolvedModule) continue
        const finding = reachThroughFindingForResolvedModule(
          importerFile,
          dependency.specifier,
          resolvedModule,
          readFileSync(resolvedModule, "utf8"),
        )
        if (finding) findings.push(finding)
      }
    }
  }

  const byWrapper = new Map()
  for (const finding of findings) {
    if (!byWrapper.has(finding.wrapper)) byWrapper.set(finding.wrapper, finding)
  }
  return [...byWrapper.values()].sort((left, right) =>
    compareCodePoints(left.wrapper, right.wrapper),
  )
}

const WRAPPER_DOC_START =
  "<!-- architecture-guard:reach-through-wrappers:start -->"
const WRAPPER_DOC_END = "<!-- architecture-guard:reach-through-wrappers:end -->"
// Bootstrap authority only. Once the generated registry is committed, the
// committed baseline (not this seed or the documentation mirror) is the
// authoritative upper bound for every update.
const OWNER_AUTHORIZED_INITIAL_REACH_THROUGH_WRAPPERS = [
  "chat-attachments",
  "claude-credentials",
  "codex/cli-path",
  "codex/runtime-status",
  "db",
  "electron-app",
  "local-only",
  "mcp-auth",
  "provider-token",
  "secure-storage",
  "skills/registry",
  "utility-chat-completion",
]

function parseDocumentedReachThroughWrappers(content) {
  if (
    content.split(WRAPPER_DOC_START).length !== 2 ||
    content.split(WRAPPER_DOC_END).length !== 2
  ) {
    return null
  }
  const start = content.indexOf(WRAPPER_DOC_START)
  const end = content.indexOf(WRAPPER_DOC_END)
  if (start === -1 || end === -1 || end <= start) return null
  const block = content.slice(start + WRAPPER_DOC_START.length, end)
  const wrappers = [...block.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map(
    (match) => match[1],
  )
  return wrappers.length === new Set(wrappers).size ? wrappers : null
}

function sameStringSet(left, right) {
  return (
    JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right))
  )
}

function unregisteredReachThroughFindings(findings, registry) {
  const registered = new Set(registry)
  return findings.filter((finding) => !registered.has(finding.wrapper))
}

function staleReachThroughWrappers(findings, registry) {
  const currentWrappers = new Set(findings.map((finding) => finding.wrapper))
  return registry.filter((wrapper) => !currentWrappers.has(wrapper))
}

function exactObjectKeys(value, expected, label) {
  const actual = value && typeof value === "object" ? Object.keys(value) : []
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${label} must contain exactly these ordered keys: ${expected.join(", ")}.`,
    )
    return false
  }
  return true
}

function validateArchitectureBaselineShape(baseline, label) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    fail(`${label} must be a JSON object.`)
    return false
  }
  let valid = exactObjectKeys(
    baseline,
    [
      "_meta",
      "routeSurfaceRatchets",
      "importBoundaryViolations",
      "reverseDirectionImports",
      "reachThroughWrappers",
    ],
    label,
  )
  const canonicalMeta = architectureBaselineMeta()
  if (
    !exactObjectKeys(
      baseline._meta,
      Object.keys(canonicalMeta),
      `${label}._meta`,
    ) ||
    JSON.stringify(baseline._meta) !== JSON.stringify(canonicalMeta)
  ) {
    fail(
      `${label}._meta must equal the canonical generated-only/only-shrink policy.`,
    )
    valid = false
  }

  const routeFiles = ROUTE_SURFACE_TARGETS.map((target) => target.file)
  if (
    !exactObjectKeys(
      baseline.routeSurfaceRatchets,
      routeFiles,
      `${label}.routeSurfaceRatchets`,
    )
  ) {
    valid = false
  }
  for (const file of routeFiles) {
    const entry = baseline.routeSurfaceRatchets?.[file]
    const expectedKeys = entry?.raiseNote
      ? ["lines", "exports", "raiseNote"]
      : ["lines", "exports"]
    if (
      !exactObjectKeys(
        entry,
        expectedKeys,
        `${label}.routeSurfaceRatchets.${file}`,
      ) ||
      !Number.isInteger(entry?.lines) ||
      entry.lines < 0 ||
      !Array.isArray(entry.exports) ||
      !entry.exports.every((name) => typeof name === "string") ||
      JSON.stringify(entry.exports) !==
        JSON.stringify(sortedUnique(entry.exports)) ||
      ("raiseNote" in entry &&
        (typeof entry.raiseNote !== "string" || !entry.raiseNote.trim()))
    ) {
      fail(`${label}.routeSurfaceRatchets.${file} has malformed ratchet data.`)
      valid = false
    }
  }

  if (!Array.isArray(baseline.importBoundaryViolations)) {
    fail(`${label}.importBoundaryViolations must be an array.`)
    valid = false
  } else {
    for (const [
      index,
      finding,
    ] of baseline.importBoundaryViolations.entries()) {
      if (
        !exactObjectKeys(
          finding,
          ["file", "specifier", "category"],
          `${label}.importBoundaryViolations[${index}]`,
        ) ||
        ![finding.file, finding.specifier, finding.category].every(
          (value) => typeof value === "string" && value.length > 0,
        ) ||
        !["Electron", "tRPC", "renderer", "preload"].includes(finding.category)
      ) {
        fail(`${label}.importBoundaryViolations[${index}] is malformed.`)
        valid = false
      }
    }
    const keys = baseline.importBoundaryViolations.map((finding) =>
      findingKey(finding, ["file", "specifier", "category"]),
    )
    if (JSON.stringify(keys) !== JSON.stringify(sortedUnique(keys))) {
      fail(
        `${label}.importBoundaryViolations must be unique and code-point sorted.`,
      )
      valid = false
    }
  }
  if (!Array.isArray(baseline.reverseDirectionImports)) {
    fail(`${label}.reverseDirectionImports must be an array.`)
    valid = false
  } else {
    for (const [index, finding] of baseline.reverseDirectionImports.entries()) {
      if (
        !exactObjectKeys(
          finding,
          ["file", "specifier"],
          `${label}.reverseDirectionImports[${index}]`,
        ) ||
        ![finding.file, finding.specifier].every(
          (value) => typeof value === "string" && value.length > 0,
        )
      ) {
        fail(`${label}.reverseDirectionImports[${index}] is malformed.`)
        valid = false
      }
    }
    const keys = baseline.reverseDirectionImports.map((finding) =>
      findingKey(finding, ["file", "specifier"]),
    )
    if (JSON.stringify(keys) !== JSON.stringify(sortedUnique(keys))) {
      fail(
        `${label}.reverseDirectionImports must be unique and code-point sorted.`,
      )
      valid = false
    }
  }
  if (
    !Array.isArray(baseline.reachThroughWrappers) ||
    !baseline.reachThroughWrappers.every(
      (wrapper) => typeof wrapper === "string" && wrapper.length > 0,
    )
  ) {
    fail(`${label}.reachThroughWrappers must contain non-empty strings only.`)
    valid = false
  } else if (
    JSON.stringify(baseline.reachThroughWrappers) !==
    JSON.stringify(sortedUnique(baseline.reachThroughWrappers))
  ) {
    fail(`${label}.reachThroughWrappers must be unique and code-point sorted.`)
    valid = false
  }
  return valid
}

function parseArchitectureBaselineContent(
  content,
  label,
  reportFailure = fail,
) {
  if (typeof content !== "string" || content.trim().length === 0) {
    reportFailure(`${label} must contain non-empty JSON content.`)
    return null
  }
  try {
    const baseline = JSON.parse(content)
    return validateArchitectureBaselineShape(baseline, label) ? baseline : null
  } catch (error) {
    reportFailure(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    )
    return null
  }
}

function parseArchitectureBaselines() {
  const content = readText(ARCHITECTURE_BASELINE_PATH)
  return parseArchitectureBaselineContent(content, ARCHITECTURE_BASELINE_PATH)
}

function readCommittedArchitectureBaselines(
  reference,
  label,
  { allowMissingFile = false } = {},
) {
  const commit = spawnSync(
    "git",
    ["rev-parse", "--verify", `${reference}^{commit}`],
    { cwd: repoRoot, encoding: "utf8" },
  )
  if (commit.status !== 0) {
    fail(
      `Cannot resolve ${label} (${reference}) as a committed architecture-baseline reference: ${String(commit.stderr ?? "").trim() || `git exited ${commit.status}`}.`,
    )
    return null
  }
  const commitSha = commit.stdout.trim()
  const result = spawnSync(
    "git",
    ["show", `${commitSha}:${ARCHITECTURE_BASELINE_PATH}`],
    { cwd: repoRoot, encoding: "utf8" },
  )
  if (result.status === 0) {
    const baseline = parseArchitectureBaselineContent(
      result.stdout,
      `${label}:${ARCHITECTURE_BASELINE_PATH}`,
    )
    return baseline ? { baseline, commitSha, label } : null
  }
  const stderr = String(result.stderr ?? "")
  if (
    result.status === 128 &&
    (stderr.includes("does not exist in") ||
      stderr.includes("exists on disk, but not in"))
  ) {
    if (allowMissingFile) return { baseline: null, commitSha, label }
    fail(
      `${label}:${ARCHITECTURE_BASELINE_PATH} is missing; the normal architecture guard requires a committed baseline.`,
    )
    return null
  }
  fail(
    `Cannot read ${label}:${ARCHITECTURE_BASELINE_PATH}: ${stderr.trim() || `git exited ${result.status}`}.`,
  )
  return null
}

function previousArchitectureBaselineRevision() {
  const result = spawnSync(
    "git",
    ["log", "--format=%H", "--", ARCHITECTURE_BASELINE_PATH],
    { cwd: repoRoot, encoding: "utf8" },
  )
  if (result.status !== 0) {
    fail(
      `Cannot inspect committed ${ARCHITECTURE_BASELINE_PATH} history: ${String(result.stderr ?? "").trim() || `git exited ${result.status}`}.`,
    )
    return null
  }
  const revisions = result.stdout
    .split(/\r?\n/u)
    .map((revision) => revision.trim())
    .filter(Boolean)
  return revisions.length > 1 ? revisions[1] : null
}

function collectBootstrapSourceChanges() {
  const commands = [
    ["diff", "--name-only", "--diff-filter=ACMRD", "HEAD", "--", "src"],
    ["ls-files", "--others", "--exclude-standard", "--", "src"],
  ]
  const changes = new Set()
  for (const args of commands) {
    const result = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    })
    if (result.error) {
      fail(
        `Cannot verify architecture-baseline bootstrap source state: ${result.error.message}.`,
      )
      continue
    }
    if (result.status !== 0) {
      fail(
        `Cannot verify architecture-baseline bootstrap source state: git ${args.join(" ")} exited ${result.status}.`,
      )
      continue
    }
    for (const file of result.stdout.split("\n").filter(Boolean)) {
      changes.add(file)
    }
  }
  return [...changes].sort(compareCodePoints)
}

function assertCanonicalFindingOrder(findings, fields, label) {
  const keys = findings.map((finding) => findingKey(finding, fields))
  if (JSON.stringify(keys) !== JSON.stringify(sortedUnique(keys))) {
    fail(`${label} must be unique and deterministically sorted.`)
  }
}

function frozenFindingSetMessages(current, baseline, fields, label) {
  const currentByKey = new Map(
    current.map((finding) => [findingKey(finding, fields), finding]),
  )
  const baselineByKey = new Map(
    baseline.map((finding) => [findingKey(finding, fields), finding]),
  )
  const messages = []
  for (const [key, finding] of currentByKey) {
    if (!baselineByKey.has(key)) {
      messages.push(
        `${label} has an unbaselined finding ${JSON.stringify(finding)}.`,
      )
    }
  }
  for (const [key, finding] of baselineByKey) {
    if (!currentByKey.has(key)) {
      messages.push(
        `${label} baseline entry ${JSON.stringify(finding)} is stale; delete it to tighten the baseline.`,
      )
    }
  }
  return messages
}

function assertRouteSurfaceRatchets(baseline) {
  const measured = measureRouteSurfaces()
  const expectedFiles = ROUTE_SURFACE_TARGETS.map((target) => target.file)
  const baselineFiles = Object.keys(baseline.routeSurfaceRatchets).sort(
    compareCodePoints,
  )
  if (
    JSON.stringify([...expectedFiles].sort(compareCodePoints)) !==
    JSON.stringify(baselineFiles)
  ) {
    fail(
      `${ARCHITECTURE_BASELINE_PATH} routeSurfaceRatchets must name exactly ${expectedFiles.join(", ")}.`,
    )
    return
  }

  for (const target of ROUTE_SURFACE_TARGETS) {
    const entry = baseline.routeSurfaceRatchets[target.file]
    if (
      !entry ||
      !Number.isInteger(entry.lines) ||
      !Array.isArray(entry.exports)
    ) {
      fail(`${target.file} has an invalid routeSurfaceRatchets entry.`)
      continue
    }
    if (
      JSON.stringify(entry.exports) !==
      JSON.stringify(sortedUnique(entry.exports))
    ) {
      fail(
        `${target.file} routeSurfaceRatchets exports must be unique and sorted.`,
      )
    }
    for (const message of routeSurfaceMessages(
      target.file,
      measured[target.file],
      entry,
      target,
    )) {
      fail(message)
    }
  }
}

function assertRuntimeCoreImportBoundary(baseline) {
  assertRuntimeCoreImportBoundarySelfTest()
  assertCanonicalFindingOrder(
    baseline.importBoundaryViolations,
    ["file", "specifier", "category"],
    `${ARCHITECTURE_BASELINE_PATH} importBoundaryViolations`,
  )
  const current = collectCurrentImportBoundaryViolations()
  for (const message of frozenFindingSetMessages(
    current,
    baseline.importBoundaryViolations,
    ["file", "specifier", "category"],
    "Runtime Core Import Boundary",
  )) {
    fail(`${message} See ${RUNTIME_CORE_OWNERSHIP_SECTION}.`)
  }
}

function assertReverseDirectionImports(baseline) {
  assertCanonicalFindingOrder(
    baseline.reverseDirectionImports,
    ["file", "specifier"],
    `${ARCHITECTURE_BASELINE_PATH} reverseDirectionImports`,
  )
  const current = collectCurrentReverseDirectionImports()
  for (const message of frozenFindingSetMessages(
    current,
    baseline.reverseDirectionImports,
    ["file", "specifier"],
    "lib-to-tRPC-router reverse-direction check",
  )) {
    fail(`${message} See ${RUNTIME_CORE_OWNERSHIP_SECTION}.`)
  }
}

function assertReachThroughWrapperRegistry(baseline) {
  const registry = sortedUnique(baseline.reachThroughWrappers)
  if (
    registry.length !== baseline.reachThroughWrappers.length ||
    JSON.stringify(registry) !== JSON.stringify(baseline.reachThroughWrappers)
  ) {
    fail(
      `${ARCHITECTURE_BASELINE_PATH} reachThroughWrappers must be unique and sorted.`,
    )
  }

  const documented = parseDocumentedReachThroughWrappers(
    readText(OWNERSHIP_MAP_PATH),
  )
  if (!documented) {
    fail(
      `${OWNERSHIP_MAP_PATH} must contain one unique wrapper registry mirror block.`,
    )
  } else if (!sameStringSet(documented, registry)) {
    fail(
      `${OWNERSHIP_MAP_PATH} wrapper mirror must name exactly the canonical reachThroughWrappers registry.`,
    )
  }

  const currentFindings = collectCurrentReachThroughFindings()
  for (const finding of unregisteredReachThroughFindings(
    currentFindings,
    registry,
  )) {
    fail(
      `${finding.importer} reaches banned ${finding.categories.join("/")} ownership through unregistered one-hop wrapper ${finding.wrapper} (${JSON.stringify(finding.specifier)}); adding a registry entry is Red and requires explicit Owner approval.`,
    )
  }

  for (const wrapper of staleReachThroughWrappers(currentFindings, registry)) {
    fail(
      `${ARCHITECTURE_BASELINE_PATH} reachThroughWrappers baseline entry ${JSON.stringify(wrapper)} is stale; delete it to tighten the baseline.`,
    )
  }
}

function assertArchitectureRatchetSelfTests() {
  if (
    JSON.stringify(sortedUnique(["z", "ä", "a", "Z"])) !==
    JSON.stringify(["Z", "a", "z", "ä"])
  ) {
    fail(
      "Architecture baseline sorting self-test must use deterministic code-point order.",
    )
  }

  for (const [content, expectedMessage] of [
    ["", "non-empty JSON content"],
    [" \n\t", "non-empty JSON content"],
    ["{not-json", "valid JSON"],
  ]) {
    const parserFailures = []
    const parsed = parseArchitectureBaselineContent(
      content,
      "architecture baseline parser fixture",
      (message) => parserFailures.push(message),
    )
    if (
      parsed !== null ||
      parserFailures.length !== 1 ||
      !parserFailures[0].includes(expectedMessage)
    ) {
      fail(
        "Architecture baseline parser self-test must fail closed on empty, whitespace-only, and invalid content.",
      )
      break
    }
  }

  const ciSelfTest = parseYaml(`
jobs:
  test-typecheck-build:
    steps:
      - run: bun run architecture:check
        env:
          DIFF_BASE_SHA: ${JSON.stringify(CI_DIFF_BASE_SHA_EXPRESSION)}
      - run: bun run retired-runtime:check-disabled
      - run: bun run retired-runtime:check
        continue-on-error: true
  conditional-main:
    steps:
      - run: bun run retired-runtime:check
        if: false
  nonblocking-job:
    continue-on-error: true
    steps:
      - run: bun run retired-runtime:check
  conditional-job:
    if: false
    steps:
      - run: bun run retired-runtime:check
  debt-report:
    steps:
      - run: bun run retired-runtime:check
# run: bun run retired-runtime:check
`)
  if (
    !shellConjunctionRunsExactCommand(
      "bun run lint && bun run retired-runtime:check && bun run test",
      "bun run retired-runtime:check",
    ) ||
    shellConjunctionRunsExactCommand(
      "bun run lint && bun run retired-runtime:check-disabled",
      "bun run retired-runtime:check",
    ) ||
    !workflowJobRunsExactBlockingCommand(
      ciSelfTest,
      "test-typecheck-build",
      "bun run architecture:check",
    ) ||
    !workflowJobRunsExactBlockingCommandWithEnv(
      ciSelfTest,
      "test-typecheck-build",
      "bun run architecture:check",
      "DIFF_BASE_SHA",
      CI_DIFF_BASE_SHA_EXPRESSION,
    ) ||
    workflowJobRunsExactBlockingCommandWithEnv(
      ciSelfTest,
      "test-typecheck-build",
      "bun run architecture:check",
      "DIFF_BASE_SHA",
      "wrong-base",
    ) ||
    workflowJobRunsExactBlockingCommand(
      ciSelfTest,
      "test-typecheck-build",
      "bun run retired-runtime:check",
    ) ||
    workflowJobRunsExactBlockingCommand(
      ciSelfTest,
      "conditional-main",
      "bun run retired-runtime:check",
    ) ||
    workflowJobRunsExactBlockingCommand(
      ciSelfTest,
      "nonblocking-job",
      "bun run retired-runtime:check",
    ) ||
    workflowJobRunsExactBlockingCommand(
      ciSelfTest,
      "conditional-job",
      "bun run retired-runtime:check",
    )
  ) {
    fail(
      "Architecture self-lock self-test must require exact package stages and exact commands in the blocking CI job.",
    )
  }

  const routeTarget = ROUTE_SURFACE_TARGETS[0]
  const exactRoute = { lines: 1, exports: ["fixture"] }
  if (
    routeSurfaceMessages(routeTarget.file, exactRoute, exactRoute, routeTarget)
      .length !== 0 ||
    !routeSurfaceMessages(
      routeTarget.file,
      { lines: 2, exports: ["fixture"] },
      exactRoute,
      routeTarget,
    ).some((message) => message.includes("grew to 2 lines")) ||
    !routeSurfaceMessages(
      routeTarget.file,
      { lines: 0, exports: ["fixture"] },
      exactRoute,
      routeTarget,
    ).some((message) => message.includes("tighten")) ||
    !routeSurfaceMessages(
      routeTarget.file,
      { lines: 1, exports: ["fixture", "newExport"] },
      exactRoute,
      routeTarget,
    ).some((message) => message.includes("newExport"))
  ) {
    fail(
      "Route surface ratchet self-test must cover exact, above, below, and unlisted-export cases.",
    )
  }

  const baselined = [
    { file: "fixture.ts", specifier: "electron", category: "Electron" },
  ]
  if (
    frozenFindingSetMessages(
      baselined,
      baselined,
      ["file", "specifier", "category"],
      "fixture",
    ).length !== 0 ||
    !frozenFindingSetMessages(
      [
        ...baselined,
        { file: "new.ts", specifier: "electron", category: "Electron" },
      ],
      baselined,
      ["file", "specifier", "category"],
      "fixture",
    ).some((message) => message.includes("unbaselined"))
  ) {
    fail(
      "Architecture finding-baseline self-test must pass frozen findings and reject growth.",
    )
  }

  const reverse = collectReverseDirectionImportFindings(
    "src/main/lib/__architecture_reverse_fixture__.ts",
    'import type { appRouter } from "./trpc/routers/index"',
  )
  if (reverse.length !== 1 || reverse[0].specifier !== "./trpc/routers/index") {
    fail(
      "Reverse-direction import self-test must detect a lib-to-router type import.",
    )
  }

  const wrapperPath = path.join(repoRoot, "src/main/lib/fixture-wrapper.ts")
  const wrapperFinding = reachThroughFindingForResolvedModule(
    "src/main/lib/headless/__architecture_wrapper_fixture__.ts",
    "../fixture-wrapper",
    wrapperPath,
    'import { app } from "electron"',
  )
  if (!wrapperFinding) {
    fail(
      "Reach-through wrapper self-test must detect an unlisted one-hop wrapper.",
    )
  } else if (
    wrapperFinding.wrapper !== "fixture-wrapper" ||
    unregisteredReachThroughFindings([wrapperFinding], ["known-wrapper"])
      .length !== 1
  ) {
    fail(
      "Reach-through wrapper self-test must detect an unlisted one-hop wrapper.",
    )
  }

  const staleWrapperEntries = staleReachThroughWrappers(
    [{ wrapper: wrapperFinding?.wrapper ?? "fixture-wrapper" }],
    ["fixture-wrapper", "stale-wrapper"],
  )
  if (
    staleWrapperEntries.length !== 1 ||
    staleWrapperEntries[0] !== "stale-wrapper"
  ) {
    fail(
      "Reach-through wrapper registry self-test must reject entries without a live one-hop finding.",
    )
  }

  const sharedWrapperFinding = reachThroughFindingForResolvedModule(
    "src/main/lib/claude/__architecture_shared_wrapper_fixture__.ts",
    "../../../shared/fixture-wrapper",
    path.join(repoRoot, "src/shared/fixture-wrapper.ts"),
    'import { app } from "electron"',
  )
  if (sharedWrapperFinding?.wrapper !== "src/shared/fixture-wrapper") {
    fail(
      "Reach-through wrapper self-test must detect repository-local wrappers outside src/main/lib with a canonical repository-relative name.",
    )
  }

  const documented = parseDocumentedReachThroughWrappers(
    `${WRAPPER_DOC_START}\n- \`one\`\n- \`two\`\n${WRAPPER_DOC_END}`,
  )
  if (!documented || sameStringSet(documented, ["one", "three"])) {
    fail("Wrapper documentation self-test must expose registry mismatches.")
  }
  const duplicatedDocumentation = parseDocumentedReachThroughWrappers(
    `${WRAPPER_DOC_START}\n- \`one\`\n${WRAPPER_DOC_END}\n${WRAPPER_DOC_START}\n- \`one\`\n${WRAPPER_DOC_END}`,
  )
  if (duplicatedDocumentation) {
    fail("Wrapper documentation self-test must reject duplicate mirror blocks.")
  }
  const authoritativeRoutes = Object.fromEntries(
    ROUTE_SURFACE_TARGETS.map(({ file }) => [
      file,
      { lines: 10, exports: ["existing"] },
    ]),
  )
  const authoritative = {
    routeSurfaceRatchets: authoritativeRoutes,
    importBoundaryViolations: [],
    reverseDirectionImports: [],
    reachThroughWrappers: ["existing-wrapper"],
  }
  const raisedRoutes = Object.fromEntries(
    ROUTE_SURFACE_TARGETS.map(({ file }) => [
      file,
      { lines: 11, exports: ["added", "existing"] },
    ]),
  )
  const handRaised = {
    routeSurfaceRatchets: raisedRoutes,
    importBoundaryViolations: [
      { file: "new.ts", specifier: "electron", category: "Electron" },
    ],
    reverseDirectionImports: [
      { file: "new.ts", specifier: "./trpc/routers/new" },
    ],
    reachThroughWrappers: ["existing-wrapper", "new-wrapper"],
  }
  const raiseMessages = architectureBaselineRaiseMessages(
    handRaised,
    authoritative,
    "fixture",
  )
  const blockingRaiseFailures = []
  assertArchitectureBaselineOnlyShrinks(
    handRaised,
    authoritative,
    "blocking fixture",
    (message) => blockingRaiseFailures.push(message),
  )
  const shrinking = {
    routeSurfaceRatchets: Object.fromEntries(
      ROUTE_SURFACE_TARGETS.map(({ file }) => [
        file,
        { lines: 9, exports: [] },
      ]),
    ),
    importBoundaryViolations: [],
    reverseDirectionImports: [],
    reachThroughWrappers: [],
  }
  if (
    !raiseMessages.some((message) => message.includes("raises")) ||
    !raiseMessages.some((message) => message.includes("export")) ||
    !raiseMessages.some((message) =>
      message.includes("importBoundaryViolations"),
    ) ||
    !raiseMessages.some((message) =>
      message.includes("reverseDirectionImports"),
    ) ||
    !raiseMessages.some((message) => message.includes("new-wrapper")) ||
    !blockingRaiseFailures.some(
      (message) =>
        message.includes("new-wrapper") &&
        message.includes("committed baseline"),
    ) ||
    architectureBaselineRaiseMessages(shrinking, authoritative, "fixture")
      .length !== 0
  ) {
    fail(
      "Architecture update self-test must reject every raise/addition while allowing only-shrink candidates.",
    )
  }
}

function architectureBaselineMeta() {
  return {
    generatedBy:
      "node scripts/check-architecture-guards.mjs --update-architecture-baselines",
    onlyShrink:
      "Generated counts and entries may only decrease. Any raise or new entry requires an explicit Owner-approved hand edit with its reason recorded in the implementing change.",
    routeSemantics:
      "routeSurfaceRatchets is a neutral data schema; Claude is temporary-owner containment and Codex is orchestration-boundary no-growth containment as defined by docs/OWNERSHIP_MAP.md.",
    reachThroughWrapperBootstrap:
      "The first 12-entry registry was Owner-authorized on 2026-08-27. After that freeze, entries may only be deleted.",
  }
}

function baselineGrowth(current, baseline, fields) {
  const allowed = new Set(
    baseline.map((finding) => findingKey(finding, fields)),
  )
  return current.filter((finding) => !allowed.has(findingKey(finding, fields)))
}

function architectureBaselineRaiseMessages(candidate, authoritative, label) {
  const messages = []
  for (const target of ROUTE_SURFACE_TARGETS) {
    const nextEntry = candidate.routeSurfaceRatchets[target.file]
    const oldEntry = authoritative.routeSurfaceRatchets[target.file]
    if (nextEntry.lines > oldEntry.lines) {
      messages.push(
        `${label} raises ${target.file} from ${oldEntry.lines} to ${nextEntry.lines} lines`,
      )
    }
    const oldExports = new Set(oldEntry.exports)
    const addedExports = nextEntry.exports.filter(
      (name) => !oldExports.has(name),
    )
    if (addedExports.length > 0) {
      messages.push(
        `${label} adds ${target.file} export(s) ${addedExports.join(", ")}`,
      )
    }
  }
  for (const finding of baselineGrowth(
    candidate.importBoundaryViolations,
    authoritative.importBoundaryViolations,
    ["file", "specifier", "category"],
  )) {
    messages.push(
      `${label} adds importBoundaryViolations entry ${JSON.stringify(finding)}`,
    )
  }
  for (const finding of baselineGrowth(
    candidate.reverseDirectionImports,
    authoritative.reverseDirectionImports,
    ["file", "specifier"],
  )) {
    messages.push(
      `${label} adds reverseDirectionImports entry ${JSON.stringify(finding)}`,
    )
  }
  const oldWrappers = new Set(authoritative.reachThroughWrappers)
  for (const wrapper of candidate.reachThroughWrappers) {
    if (!oldWrappers.has(wrapper)) {
      messages.push(`${label} adds reachThroughWrappers entry ${wrapper}`)
    }
  }
  return messages
}

function assertArchitectureBaselineOnlyShrinks(
  candidate,
  authoritative,
  label,
  reportFailure = fail,
) {
  for (const message of architectureBaselineRaiseMessages(
    candidate,
    authoritative,
    label,
  )) {
    reportFailure(
      `${message}; architecture baselines may only shrink relative to the committed baseline.`,
    )
  }
}

function formatGeneratedArchitectureBaseline() {
  const biomeEntry = path.join(
    repoRoot,
    "node_modules/@biomejs/biome/bin/biome",
  )
  if (!existsSync(biomeEntry)) {
    fail(
      `Cannot format generated ${ARCHITECTURE_BASELINE_PATH}: ${relative(biomeEntry)} is missing.`,
    )
    return
  }
  const result = spawnSync(
    process.execPath,
    [biomeEntry, "format", "--write", ARCHITECTURE_BASELINE_PATH],
    { cwd: repoRoot, encoding: "utf8" },
  )
  if (result.status !== 0) {
    fail(
      `Cannot format generated ${ARCHITECTURE_BASELINE_PATH}: ${String(result.stderr || result.stdout).trim() || `Biome exited ${result.status}`}.`,
    )
  }
}

function updateArchitectureBaselineRegistry() {
  assertRuntimeCoreImportBoundarySelfTest()
  assertArchitectureRatchetSelfTests()

  const documentedWrappers = parseDocumentedReachThroughWrappers(
    readText(OWNERSHIP_MAP_PATH),
  )
  if (!documentedWrappers) {
    fail(
      `${OWNERSHIP_MAP_PATH} must contain a unique wrapper mirror block before baseline generation.`,
    )
    return
  }
  const nextWrappers = sortedUnique(documentedWrappers)
  const workingBaseline = existsSync(
    path.join(repoRoot, ARCHITECTURE_BASELINE_PATH),
  )
    ? parseArchitectureBaselines()
    : null
  const authoritativeBaselineSnapshot = readCommittedArchitectureBaselines(
    "HEAD",
    "committed HEAD",
    { allowMissingFile: true },
  )
  const authoritativeBaseline = authoritativeBaselineSnapshot?.baseline ?? null
  const comparisonBaseline = authoritativeBaseline ?? workingBaseline
  if (
    !authoritativeBaseline &&
    JSON.stringify(nextWrappers) !==
      JSON.stringify(OWNER_AUTHORIZED_INITIAL_REACH_THROUGH_WRAPPERS)
  ) {
    fail(
      `The first reachThroughWrappers freeze must equal the exact Owner-authorized 12-entry bootstrap ${JSON.stringify(OWNER_AUTHORIZED_INITIAL_REACH_THROUGH_WRAPPERS)}.`,
    )
  }
  if (!authoritativeBaseline) {
    const bootstrapSourceChanges = collectBootstrapSourceChanges()
    if (bootstrapSourceChanges.length > 0) {
      fail(
        `Architecture baseline bootstrap refuses source-tree changes before the first baseline commit: ${bootstrapSourceChanges.join(", ")}. Foundation 1c does not authorize src/ product changes.`,
      )
    }
  }

  const routeSurfaces = measureRouteSurfaces()
  const importBoundaryViolations = collectCurrentImportBoundaryViolations()
  const reverseDirectionImports = collectCurrentReverseDirectionImports()

  const routeSurfaceRatchets = Object.fromEntries(
    ROUTE_SURFACE_TARGETS.map(({ file }) => {
      const entry = { ...routeSurfaces[file] }
      const raiseNote =
        comparisonBaseline?.routeSurfaceRatchets?.[file]?.raiseNote
      if (raiseNote) entry.raiseNote = raiseNote
      return [file, entry]
    }),
  )
  const nextBaseline = {
    _meta: architectureBaselineMeta(),
    routeSurfaceRatchets,
    importBoundaryViolations,
    reverseDirectionImports,
    reachThroughWrappers: nextWrappers,
  }

  if (authoritativeBaseline) {
    if (workingBaseline) {
      for (const message of architectureBaselineRaiseMessages(
        workingBaseline,
        authoritativeBaseline,
        "Working baseline hand edit",
      )) {
        fail(
          `Update refused: ${message}; raises/additions require explicit Owner handling outside update mode.`,
        )
      }
    }
  }
  if (comparisonBaseline) {
    for (const message of architectureBaselineRaiseMessages(
      nextBaseline,
      comparisonBaseline,
      authoritativeBaseline
        ? "Measured baseline"
        : "Bootstrap measured baseline",
    )) {
      fail(
        `Update refused: ${message}; raises/additions require an explicit Owner-approved guard/spec change plus a recorded baseline edit outside update mode.`,
      )
    }
  }

  const wrapperSet = new Set(nextWrappers)
  for (const finding of collectCurrentReachThroughFindings()) {
    if (!wrapperSet.has(finding.wrapper)) {
      fail(
        `Update refused: detected unregistered one-hop wrapper ${finding.wrapper}; adding it is Red and requires explicit Owner approval.`,
      )
    }
  }
  if (failures.length > 0) return
  writeFileSync(
    path.join(repoRoot, ARCHITECTURE_BASELINE_PATH),
    `${JSON.stringify(nextBaseline, null, 2)}\n`,
  )
  formatGeneratedArchitectureBaseline()
  if (failures.length > 0) return
  console.log(`Updated ${ARCHITECTURE_BASELINE_PATH}.`)
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
  if (
    !shellConjunctionRunsExactCommand(
      scripts.check,
      "bun run architecture:check",
    )
  ) {
    fail("package.json scripts.check must include bun run architecture:check.")
  }
  if (
    scripts["retired-runtime:check"] !==
    "node scripts/check-retired-runtime-residue.mjs"
  ) {
    fail(
      "package.json scripts.retired-runtime:check must run scripts/check-retired-runtime-residue.mjs.",
    )
  }
  if (
    !shellConjunctionRunsExactCommand(
      scripts.check,
      "bun run retired-runtime:check",
    )
  ) {
    fail(
      "package.json scripts.check must include bun run retired-runtime:check.",
    )
  }
}

function shellConjunctionRunsExactCommand(script, command) {
  return String(script ?? "")
    .split("&&")
    .some((stage) => stage.trim() === command)
}

function workflowJobRunsExactBlockingCommand(workflow, jobId, command) {
  const job = workflow?.jobs?.[jobId]
  const steps = job?.steps
  return (
    job &&
    typeof job === "object" &&
    (job["continue-on-error"] === undefined ||
      job["continue-on-error"] === false) &&
    job.if === undefined &&
    Array.isArray(steps) &&
    steps.some(
      (step) =>
        step &&
        typeof step === "object" &&
        typeof step.run === "string" &&
        step.run.trim() === command &&
        (step["continue-on-error"] === undefined ||
          step["continue-on-error"] === false) &&
        step.if === undefined,
    )
  )
}

function workflowJobRunsExactBlockingCommandWithEnv(
  workflow,
  jobId,
  command,
  envName,
  envValue,
) {
  const job = workflow?.jobs?.[jobId]
  const steps = job?.steps
  return (
    job &&
    typeof job === "object" &&
    (job["continue-on-error"] === undefined ||
      job["continue-on-error"] === false) &&
    job.if === undefined &&
    Array.isArray(steps) &&
    steps.some(
      (step) =>
        step &&
        typeof step === "object" &&
        typeof step.run === "string" &&
        step.run.trim() === command &&
        (step["continue-on-error"] === undefined ||
          step["continue-on-error"] === false) &&
        step.if === undefined &&
        step.env?.[envName] === envValue,
    )
  )
}

function assertCiRunsArchitectureCheck() {
  const ciSource = readText(".github/workflows/ci.yml")
  let ci
  try {
    ci = parseYaml(ciSource)
  } catch (error) {
    fail(
      `.github/workflows/ci.yml must be valid YAML: ${error instanceof Error ? error.message : String(error)}.`,
    )
    return
  }
  const mainJob = "test-typecheck-build"
  if (
    !workflowJobRunsExactBlockingCommand(
      ci,
      mainJob,
      "bun run architecture:check",
    )
  ) {
    fail(
      `GitHub CI job ${mainJob} must run the exact blocking, unconditional command bun run architecture:check.`,
    )
  }
  if (
    !workflowJobRunsExactBlockingCommandWithEnv(
      ci,
      mainJob,
      "bun run architecture:check",
      "DIFF_BASE_SHA",
      CI_DIFF_BASE_SHA_EXPRESSION,
    )
  ) {
    fail(
      `GitHub CI job ${mainJob} architecture:check step must set DIFF_BASE_SHA to the exact pull-request base/push-before expression.`,
    )
  }
  if (
    !workflowJobRunsExactBlockingCommand(
      ci,
      mainJob,
      "bun run retired-runtime:check",
    )
  ) {
    fail(
      `GitHub CI job ${mainJob} must run the exact blocking, unconditional command bun run retired-runtime:check.`,
    )
  }
}

function assertOwnershipDocs() {
  const requiredSections = [
    "## Runtime Capability Truth",
    "## Runtime Chat UI Event State",
    "## Renderer Chat Message Model And Hydration",
    "## Chat Session Binding",
    "## Chat Maintenance Fence",
    "## Managed Worktree Path Parsing",
    "## Guard Decisions",
    "## Provider Credentials",
    "## Claude Desktop Chat Runtime",
    "## Codex Desktop Chat Runtime",
    "## Headless Agent Runtime",
    "## Runtime MCP Configuration",
    "## Runtime Core Import Boundary",
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

function assertEngineIdSingleOwner() {
  const owner = "src/shared/agent-runtime-capabilities.ts"
  const metadataAdapter = "src/shared/chat-engine-id.ts"
  const bindingVocabulary = "src/shared/chat-session-binding.ts"
  const messageModel = "src/shared/chat-message.ts"
  const content = readText(metadataAdapter)

  if (
    !content.includes("CONTRACT_RUNTIME_IDS") ||
    !content.includes('from "./agent-runtime-capabilities"')
  ) {
    fail(
      `${metadataAdapter} must import engine identity from CONTRACT_RUNTIME_IDS in ${owner}. See docs/OWNERSHIP_MAP.md.`,
    )
  }
  if (!content.includes("agentChatProviders = CONTRACT_RUNTIME_IDS")) {
    fail(
      `${metadataAdapter} must derive agentChatProviders from CONTRACT_RUNTIME_IDS in ${owner}. See docs/OWNERSHIP_MAP.md.`,
    )
  }
  if (!content.includes("ChatEngineId = AgentRuntimeContractId")) {
    fail(
      `${metadataAdapter} must derive ChatEngineId from AgentRuntimeContractId in ${owner}. See docs/OWNERSHIP_MAP.md.`,
    )
  }
  if (
    /\[[^\]]*["'](?:claude-code|codex)["'][^\]]*\]\s*as\s+const/s.test(content)
  ) {
    fail(
      `${metadataAdapter} must not declare an independent engine-id enum; derive it from CONTRACT_RUNTIME_IDS in ${owner}. See docs/OWNERSHIP_MAP.md.`,
    )
  }

  const bindingContent = readText(bindingVocabulary)
  if (
    !bindingContent.includes(
      "CHAT_SESSION_BINDING_RUNTIMES = CONTRACT_RUNTIME_IDS",
    ) ||
    !bindingContent.includes(
      "ChatSessionBindingRuntime = AgentRuntimeContractId",
    )
  ) {
    fail(
      `${bindingVocabulary} must derive its Engine IDs and type from CONTRACT_RUNTIME_IDS in ${owner}. See docs/OWNERSHIP_MAP.md.`,
    )
  }

  const messageContent = readText(messageModel)
  if (
    !messageContent.includes("agentChatProviders") ||
    !messageContent.includes("provider: z.enum(agentChatProviders)")
  ) {
    fail(
      `${messageModel} must validate persisted provider values through the chat Engine adapter derived from ${owner}. See docs/OWNERSHIP_MAP.md.`,
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

const RUNTIME_EVENT_SYMBOL_OWNERS = new Map([
  ["createRunEvent", "src/main/lib/agent-runtime/runtime-events.ts"],
  [
    "createCanonicalRunEventLedger",
    "src/main/lib/agent-runtime/run-event-ledger.ts",
  ],
  [
    "getOrCreateRunEventLedger",
    "src/main/lib/agent-runtime/run-event-ledger-host.ts",
  ],
  [
    "projectRunEventToRendererChunks",
    "src/main/lib/agent-runtime/stream-event-mapper.ts",
  ],
  ["redactRuntimePayload", "src/main/lib/agent-runtime/redaction.ts"],
  ["redactExactSecretHints", "src/main/lib/agent-runtime/redaction.ts"],
])
const JOB_EVENT_STORE_OWNER = "src/main/lib/headless/job-store.ts"
const JOB_EVENT_STORE_APPEND = "appendExactRunEventBatch"
const JOB_EVENT_STORE_INSERT = "insertExactRunEventRecord"
/** The host's exact store adapter is the only raw event writer importer. */
const APPEND_EXACT_RUN_EVENT_BATCH_IMPORTERS = [
  "src/main/lib/agent-runtime/run-event-ledger-host.ts",
]
const RUNTIME_EVENT_OWNERSHIP_SECTION =
  'docs/OWNERSHIP_MAP.md "Runtime Events, Trace, And Redaction"'

function collectTrackedSymbolFacts(filePath, content, trackedSymbols) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const definitions = new Set()
  const exports = new Set()

  function recordBinding(name, destination) {
    const names = new Set()
    collectBindingNames(name, names)
    for (const candidate of names) {
      if (trackedSymbols.has(candidate)) destination.add(candidate)
    }
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node)) {
      recordBinding(node.name, definitions)
      const statement = node.parent?.parent
      if (
        statement &&
        ts.isVariableStatement(statement) &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ) {
        recordBinding(node.name, exports)
      }
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name &&
      trackedSymbols.has(node.name.text)
    ) {
      definitions.add(node.name.text)
      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
        exports.add(node.name.text)
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        const localName = element.propertyName?.text ?? element.name.text
        if (
          trackedSymbols.has(localName) ||
          trackedSymbols.has(element.name.text)
        ) {
          const symbol = trackedSymbols.has(element.name.text)
            ? element.name.text
            : localName
          definitions.add(symbol)
          exports.add(symbol)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { definitions, exports }
}

function collectActualExportNamesForSymbol(filePath, content, symbol) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const aliases = new Set([symbol])
  const aliasCandidates = []
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      const initializer = unwrapExpression(declaration.initializer)
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        ts.isIdentifier(initializer)
      ) {
        aliasCandidates.push({
          alias: declaration.name.text,
          target: initializer.text,
        })
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of aliasCandidates) {
      if (aliases.has(candidate.target) && !aliases.has(candidate.alias)) {
        aliases.add(candidate.alias)
        changed = true
      }
    }
  }

  const names = []

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const localName = element.propertyName?.text ?? element.name.text
        if (aliases.has(localName)) names.push(element.name.text)
      }
      continue
    }

    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(unwrapExpression(statement.expression)) &&
      aliases.has(unwrapExpression(statement.expression).text)
    ) {
      names.push("default")
      continue
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === symbol
    ) {
      names.push(
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
          ? "default"
          : symbol,
      )
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const bindings = new Set()
        collectBindingNames(declaration.name, bindings)
        for (const binding of bindings) {
          if (aliases.has(binding)) names.push(binding)
        }
      }
    }
  }

  return sortedUnique(names)
}

function stripSourceExtension(filePath) {
  for (const extension of RUNTIME_CORE_SOURCE_EXTENSIONS) {
    if (filePath.endsWith(extension))
      return filePath.slice(0, -extension.length)
  }
  return filePath
}

function moduleSpecifierTargetsFile(fromFile, specifier, targetFile) {
  const resolved = resolveLocalImport(fromFile, specifier)
  if (!resolved) return false
  const normalizedResolved = stripSourceExtension(path.normalize(resolved))
  const normalizedTarget = stripSourceExtension(
    path.normalize(path.join(repoRoot, targetFile)),
  )
  return (
    normalizedResolved === normalizedTarget ||
    path.join(normalizedResolved, "index") === normalizedTarget
  )
}

function reexportsWholeModuleFrom(filePath, content, targetFile) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  return sourceFile.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      (!statement.exportClause ||
        ts.isNamespaceExport(statement.exportClause)) &&
      moduleSpecifierTargetsFile(
        filePath,
        stringLiteralValue(statement.moduleSpecifier) ?? "",
        targetFile,
      ),
  )
}

function importsNamedSymbolFrom(filePath, content, targetFile, symbol) {
  const importsTarget = collectDependencyReferences(filePath, content).some(
    (dependency) =>
      moduleSpecifierTargetsFile(filePath, dependency.specifier, targetFile),
  )
  if (!importsTarget) return false

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  let found = false
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === symbol) {
      found = true
    } else if (
      ts.isElementAccessExpression(node) &&
      stringLiteralValue(node.argumentExpression) === symbol
    ) {
      found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function assertRuntimeEventSinglePathSelfTest() {
  const duplicate = collectTrackedSymbolFacts(
    "src/main/lib/duplicate.ts",
    "export function createRunEvent() {}",
    new Set(RUNTIME_EVENT_SYMBOL_OWNERS.keys()),
  )
  const rawImport = importsNamedSymbolFrom(
    "src/main/lib/disallowed.ts",
    'import { appendExactRunEventBatch } from "./headless/job-store"',
    JOB_EVENT_STORE_OWNER,
    JOB_EVENT_STORE_APPEND,
  )
  const clean = collectTrackedSymbolFacts(
    "src/main/lib/clean.ts",
    'import { getOrCreateRunEventLedger as host } from "./agent-runtime/run-event-ledger-host"; void host',
    new Set(RUNTIME_EVENT_SYMBOL_OWNERS.keys()),
  )
  const privateOwner = collectTrackedSymbolFacts(
    "src/main/lib/private-owner.ts",
    "function createRunEvent() {}",
    new Set(RUNTIME_EVENT_SYMBOL_OWNERS.keys()),
  )
  const secondaryReexport = collectTrackedSymbolFacts(
    "src/main/lib/secondary.ts",
    'export { createRunEvent } from "./agent-runtime/runtime-events"',
    new Set(RUNTIME_EVENT_SYMBOL_OWNERS.keys()),
  )
  const rawImportFixtures = [
    'import { appendExactRunEventBatch } from "./headless/job-store"',
    'import * as store from "./headless/job-store"; store.appendExactRunEventBatch',
    'const store = await import("./headless/job-store"); store.appendExactRunEventBatch',
    'import store = require("./headless/job-store"); store.appendExactRunEventBatch',
    'const { appendExactRunEventBatch } = require("./headless/job-store")',
    'const store = module.require("./headless/job-store"); store["appendExactRunEventBatch"]',
    'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); const store = load("./headless/job-store"); store.appendExactRunEventBatch',
  ]
  const detectsEveryRawImportSyntax = rawImportFixtures.every((content) =>
    importsNamedSymbolFrom(
      "src/main/lib/disallowed.ts",
      content,
      JOB_EVENT_STORE_OWNER,
      JOB_EVENT_STORE_APPEND,
    ),
  )
  const ignoresOtherJobStoreImports = !importsNamedSymbolFrom(
    "src/main/lib/clean-job-store-import.ts",
    'import { getAgentJob } from "./headless/job-store"; const example = "appendExactRunEventBatch"; void getAgentJob; void example',
    JOB_EVENT_STORE_OWNER,
    JOB_EVENT_STORE_APPEND,
  )
  const aliasedAppendExports = collectActualExportNamesForSymbol(
    JOB_EVENT_STORE_OWNER,
    "const rawWrite = appendExactRunEventBatch; export const rawWriteAgain = rawWrite; export { appendExactRunEventBatch, rawWrite }; export default rawWriteAgain",
    JOB_EVENT_STORE_APPEND,
  )
  const defaultInsertExport = collectActualExportNamesForSymbol(
    JOB_EVENT_STORE_OWNER,
    "export const rawInsert = insertExactRunEventRecord; export default rawInsert",
    JOB_EVENT_STORE_INSERT,
  )
  if (
    !duplicate.definitions.has("createRunEvent") ||
    !duplicate.exports.has("createRunEvent") ||
    !rawImport ||
    clean.definitions.size !== 0 ||
    clean.exports.size !== 0 ||
    !privateOwner.definitions.has("createRunEvent") ||
    privateOwner.exports.has("createRunEvent") ||
    !secondaryReexport.exports.has("createRunEvent") ||
    !detectsEveryRawImportSyntax ||
    !ignoresOtherJobStoreImports ||
    JSON.stringify(aliasedAppendExports) !==
      JSON.stringify([
        "appendExactRunEventBatch",
        "default",
        "rawWrite",
        "rawWriteAgain",
      ]) ||
    JSON.stringify(defaultInsertExport) !==
      JSON.stringify(["default", "rawInsert"])
  ) {
    fail(
      "Canonical runtime-event single-path self-test must detect duplicate definitions and raw-write imports while accepting a host ledger consumer.",
    )
  }
}

function assertRuntimeEventSinglePath() {
  assertRuntimeEventSinglePathSelfTest()
  const tracked = new Set([
    ...RUNTIME_EVENT_SYMBOL_OWNERS.keys(),
    JOB_EVENT_STORE_APPEND,
    JOB_EVENT_STORE_INSERT,
  ])
  const definitionSites = new Map(
    [...RUNTIME_EVENT_SYMBOL_OWNERS.keys()].map((symbol) => [symbol, []]),
  )
  const exportSites = new Map(
    [...RUNTIME_EVENT_SYMBOL_OWNERS.keys()].map((symbol) => [symbol, []]),
  )
  const exportedAppendSites = []
  let canonicalAppendExportNames = []
  let canonicalInsertExportNames = []
  const exportedInsertSites = []
  const directImporters = []

  for (const absolutePath of walkFiles("src", RUNTIME_CORE_SOURCE_EXTENSIONS)) {
    const filePath = relative(absolutePath)
    const content = readFileSync(absolutePath, "utf8")
    const facts = collectTrackedSymbolFacts(filePath, content, tracked)
    for (const [symbol, owner] of RUNTIME_EVENT_SYMBOL_OWNERS) {
      if (
        facts.definitions.has(symbol) ||
        reexportsWholeModuleFrom(filePath, content, owner)
      )
        definitionSites.get(symbol).push(filePath)
      if (
        facts.exports.has(symbol) ||
        reexportsWholeModuleFrom(filePath, content, owner)
      )
        exportSites.get(symbol).push(filePath)
    }
    if (
      facts.exports.has(JOB_EVENT_STORE_APPEND) ||
      reexportsWholeModuleFrom(filePath, content, JOB_EVENT_STORE_OWNER)
    )
      exportedAppendSites.push(filePath)
    if (filePath === JOB_EVENT_STORE_OWNER) {
      canonicalAppendExportNames = collectActualExportNamesForSymbol(
        filePath,
        content,
        JOB_EVENT_STORE_APPEND,
      )
      canonicalInsertExportNames = collectActualExportNamesForSymbol(
        filePath,
        content,
        JOB_EVENT_STORE_INSERT,
      )
    }
    if (facts.exports.has(JOB_EVENT_STORE_INSERT))
      exportedInsertSites.push(filePath)
    if (
      filePath !== JOB_EVENT_STORE_OWNER &&
      importsNamedSymbolFrom(
        filePath,
        content,
        JOB_EVENT_STORE_OWNER,
        JOB_EVENT_STORE_APPEND,
      )
    ) {
      directImporters.push(filePath)
    }
  }

  for (const [symbol, owner] of RUNTIME_EVENT_SYMBOL_OWNERS) {
    const sites = sortedUnique(definitionSites.get(symbol))
    if (sites.length !== 1 || sites[0] !== owner) {
      fail(
        `${symbol} must be defined or re-exported only from ${owner}; found ${sites.join(", ") || "none"}. See ${RUNTIME_EVENT_OWNERSHIP_SECTION}.`,
      )
    }
    const publicSites = sortedUnique(exportSites.get(symbol))
    if (publicSites.length !== 1 || publicSites[0] !== owner) {
      fail(
        `${symbol} must remain publicly exported only from ${owner}; found ${publicSites.join(", ") || "none"}. See ${RUNTIME_EVENT_OWNERSHIP_SECTION}.`,
      )
    }
  }
  if (
    exportedAppendSites.length !== 1 ||
    exportedAppendSites[0] !== JOB_EVENT_STORE_OWNER
  ) {
    fail(
      `${JOB_EVENT_STORE_APPEND} must be exported only from ${JOB_EVENT_STORE_OWNER}; found ${exportedAppendSites.join(", ") || "none"}.`,
    )
  }
  if (
    JSON.stringify(canonicalAppendExportNames) !==
    JSON.stringify([JOB_EVENT_STORE_APPEND])
  ) {
    fail(
      `${JOB_EVENT_STORE_APPEND} must not gain an alias or default export in ${JOB_EVENT_STORE_OWNER}; found export names ${canonicalAppendExportNames.join(", ") || "none"}.`,
    )
  }
  if (exportedInsertSites.length > 0) {
    fail(
      `${JOB_EVENT_STORE_INSERT} must remain module-private in ${JOB_EVENT_STORE_OWNER}; exported from ${exportedInsertSites.join(", ")}.`,
    )
  }
  if (canonicalInsertExportNames.length > 0) {
    fail(
      `${JOB_EVENT_STORE_INSERT} must remain module-private in ${JOB_EVENT_STORE_OWNER}; found export names ${canonicalInsertExportNames.join(", ")}.`,
    )
  }

  const measuredImporters = sortedUnique(directImporters)
  const expectedImporters = [...APPEND_EXACT_RUN_EVENT_BATCH_IMPORTERS].sort(
    compareCodePoints,
  )
  if (JSON.stringify(measuredImporters) !== JSON.stringify(expectedImporters)) {
    fail(
      `${JOB_EVENT_STORE_APPEND} direct importers must be exactly the host store adapter. Expected ${expectedImporters.join(", ")}; found ${measuredImporters.join(", ") || "none"}. Callers must submit observations and evidence through getOrCreateRunEventLedger.`,
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

const CHAT_SESSION_BINDING_OWNER = "src/main/lib/chat-session-binding.ts"
const CHAT_SESSION_BINDING_SCHEMA = "src/main/lib/db/schema/index.ts"
const CHAT_SESSION_BINDING_TRANSPORTS = [
  "src/renderer/features/agents/lib/ipc-chat-transport.ts",
  "src/renderer/features/agents/lib/codex-app-server-chat-transport.ts",
]
const CHAT_SESSION_BINDING_INPUT_SCHEMAS = [
  "src/main/lib/claude/chat-input-schema.ts",
  "src/main/lib/codex/chat-input-schema.ts",
]
const RETIRED_CHAT_BINDING_ATOM_FAMILIES = [
  "subChatModelIdAtomFamily",
  "subChatClaudeModelSourceAtomFamily",
  "subChatCodexModelSourceAtomFamily",
  "subChatCodexModelIdAtomFamily",
  "subChatCodexThinkingAtomFamily",
]
const CHAT_BINDING_SEMANTIC_NAME =
  /(?:model|source|thinking|effort|agentId|engine|runtime|provider|profile)/i
const CHAT_SESSION_BINDING_TABLE_OWNERS = new Set([
  CHAT_SESSION_BINDING_OWNER,
  CHAT_SESSION_BINDING_SCHEMA,
])
const CHAT_SESSION_BINDING_INFERENCE_OWNERS = new Set([
  CHAT_SESSION_BINDING_OWNER,
  "src/shared/chat-engine-id.ts",
])

function retiredChatBindingAtomFamiliesIn(content) {
  return RETIRED_CHAT_BINDING_ATOM_FAMILIES.filter((identifier) =>
    new RegExp(`\\b${identifier}\\b`).test(content),
  )
}

function hasDisallowedChatBindingInference(filePath, content) {
  return (
    !CHAT_SESSION_BINDING_INFERENCE_OWNERS.has(filePath) &&
    /\binferChatEngineIdFromMessages\b/.test(content)
  )
}

function hasDisallowedChatBindingTableAccess(filePath, content) {
  return (
    !CHAT_SESSION_BINDING_TABLE_OWNERS.has(filePath) &&
    /\b(?:subChatBindings|sub_chat_bindings)\b/.test(content)
  )
}

function hasTransportBindingAtomAccess(content) {
  return /\bsubChat\w*AtomFamily\b/.test(content)
}

function hasRendererNativeSessionPayload(content) {
  return /\bsessionId\s*:/.test(content)
}

function hasNativeSessionInputSchemaField(content) {
  return /\bsessionId\s*:\s*z\./.test(content)
}

function hasCodexBoundModelCatalogPath({ router, providerBinding, gateway }) {
  return (
    router.includes("providerProfileBoundModelId:") &&
    router.includes("bindingAdmission.binding.modelId") &&
    providerBinding.includes("codexChatBoundModelId:") &&
    gateway.includes("tokenScope.codexChatBoundModelId")
  )
}

function collectPerChatBindingAtomFindings(content, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const findings = []

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const name = node.name.text
      const initializer = unwrapExpression(node.initializer)
      if (initializer && ts.isCallExpression(initializer)) {
        const callee = unwrapExpression(initializer.expression)
        const helperName = ts.isIdentifier(callee) ? callee.text : null
        const isStorageHelper =
          helperName === "atomWithStorage" || helperName === "atomFamily"
        const isBindingFamilyName =
          /^subChat/i.test(name) && CHAT_BINDING_SEMANTIC_NAME.test(name)

        if (isStorageHelper && isBindingFamilyName) {
          findings.push(`${name} uses ${helperName}`)
        }

        if (helperName === "atomWithStorage") {
          const storageKey = stringLiteralValue(initializer.arguments[0])
          const perChatSuffix = storageKey?.match(/^agents:subChat(.+)$/i)?.[1]
          if (perChatSuffix && CHAT_BINDING_SEMANTIC_NAME.test(perChatSuffix)) {
            findings.push(`${name} persists ${storageKey}`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...new Set(findings)]
}

function isRendererSourcePath(filePath) {
  return filePath.startsWith("src/renderer/")
}

function assertChatSessionBindingGuardSelfTest() {
  const multilineStorageFixture = `
    const subChatRuntimeStorageAtom = atomWithStorage<
      Record<string, string>
    >(
      "agents:subChatRuntime",
      {},
    )
  `
  const familyFixture = `
    export const subChatProviderAtomFamily = atomFamily(
      (subChatId: string) => atom(subChatId),
    )
  `
  const effortFamilyFixture = `
    export const subChatEffortAtomFamily = atomFamily(
      (subChatId: string) =>
        atom(subChatId),
    )
  `
  const sourceStorageFixture = `
    const subChatSourceStorageAtom = atomWithStorage<
      Record<string, string>
    >(
      "agents:subChatSource",
      {},
    )
  `
  const allowedModeFixture = `
    const subChatModesStorageAtom = atomWithStorage(
      "agents:subChatModes",
      {},
    )
    export const subChatModeAtomFamily = atomFamily(
      (subChatId: string) => atom(subChatId),
    )
  `
  const externalRendererFixturePath =
    "src/renderer/features/fixture-binding-atoms.ts"

  if (
    collectPerChatBindingAtomFindings(
      multilineStorageFixture,
      "binding-storage-negative-fixture.ts",
    ).length === 0
  ) {
    fail(
      "Chat Session Binding guard self-test must reject multiline per-chat runtime storage.",
    )
  }
  if (
    !isRendererSourcePath(externalRendererFixturePath) ||
    collectPerChatBindingAtomFindings(
      `const subChatEngineAtomFamily = atomFamily(
        (subChatId: string) => atom(subChatId),
      )`,
      externalRendererFixturePath,
    ).length === 0
  ) {
    fail(
      "Chat Session Binding guard self-test must scan binding atom families outside the canonical atoms file.",
    )
  }
  if (
    collectPerChatBindingAtomFindings(
      familyFixture,
      "binding-family-negative-fixture.ts",
    ).length === 0
  ) {
    fail(
      "Chat Session Binding guard self-test must reject per-chat provider atom families.",
    )
  }
  if (
    collectPerChatBindingAtomFindings(
      effortFamilyFixture,
      "binding-effort-family-negative-fixture.ts",
    ).length === 0 ||
    collectPerChatBindingAtomFindings(
      sourceStorageFixture,
      "binding-source-storage-negative-fixture.ts",
    ).length === 0
  ) {
    fail(
      "Chat Session Binding guard self-test must reject per-chat effort and source storage.",
    )
  }
  if (
    collectPerChatBindingAtomFindings(
      allowedModeFixture,
      "binding-mode-positive-fixture.ts",
    ).length > 0
  ) {
    fail(
      "Chat Session Binding guard self-test must allow the non-binding sub-chat mode atom family.",
    )
  }
  if (
    retiredChatBindingAtomFamiliesIn(
      "const value = subChatCodexThinkingAtomFamily(id)",
    ).length !== 1
  ) {
    fail(
      "Chat Session Binding guard self-test must reject retired binding-family residue.",
    )
  }
  if (
    !hasDisallowedChatBindingInference(
      "src/renderer/fixture.ts",
      "inferChatEngineIdFromMessages(messages)",
    ) ||
    hasDisallowedChatBindingInference(
      CHAT_SESSION_BINDING_OWNER,
      "inferChatEngineIdFromMessages(messages)",
    )
  ) {
    fail(
      "Chat Session Binding guard self-test must allow inference only in the canonical backfill owner.",
    )
  }
  if (
    !hasTransportBindingAtomAccess(
      "appStore.get(subChatModelAtomFamily(subChatId))",
    )
  ) {
    fail(
      "Chat Session Binding guard self-test must reject transport subChat*AtomFamily access.",
    )
  }
  if (
    !hasDisallowedChatBindingTableAccess(
      "src/main/lib/trpc/routers/fixture.ts",
      "db.select().from(subChatBindings)",
    ) ||
    hasDisallowedChatBindingTableAccess(
      CHAT_SESSION_BINDING_SCHEMA,
      'sqliteTable("sub_chat_bindings")',
    )
  ) {
    fail(
      "Chat Session Binding guard self-test must reserve table access for schema and the canonical owner.",
    )
  }
  if (
    !hasRendererNativeSessionPayload(
      "const payload = { sessionId: rendererSessionId }",
    ) ||
    hasRendererNativeSessionPayload(
      "const currentSessionIdentity = loadFromMainHistory()",
    ) ||
    !hasNativeSessionInputSchemaField("sessionId: z.string().optional()")
  ) {
    fail(
      "Chat Session Binding guard self-test must reject renderer-supplied native session provenance.",
    )
  }
  if (
    !hasCodexBoundModelCatalogPath({
      router: "providerProfileBoundModelId: bindingAdmission.binding.modelId",
      providerBinding: "codexChatBoundModelId: providerProfileBoundModelId",
      gateway: "tokenScope.codexChatBoundModelId",
    }) ||
    hasCodexBoundModelCatalogPath({
      router: "providerProfileBoundModelId: profile.defaultModel",
      providerBinding: "codexChatBoundModelId: providerProfileBoundModelId",
      gateway: "tokenScope.codexChatBoundModelId",
    })
  ) {
    fail(
      "Chat Session Binding guard self-test must require admitted historical Codex catalog provenance.",
    )
  }
}

function assertChatSessionBindingSingleOwner() {
  assertChatSessionBindingGuardSelfTest()

  const sourceFiles = walkFiles("src", [".ts", ".tsx"])
  for (const absolutePath of sourceFiles) {
    const filePath = relative(absolutePath)
    const content = readFileSync(absolutePath, "utf8")

    if (isRendererSourcePath(filePath)) {
      for (const finding of collectPerChatBindingAtomFindings(
        content,
        filePath,
      )) {
        fail(
          `Per-chat binding state must not persist in renderer atoms: ${filePath} ${finding}.`,
        )
      }
    }

    for (const identifier of retiredChatBindingAtomFamiliesIn(content)) {
      fail(
        `${identifier} is retired; ${filePath} must consume the DB-backed chat binding instead.`,
      )
    }

    if (hasDisallowedChatBindingInference(filePath, content)) {
      fail(
        `Message-metadata runtime inference is retired outside backfill; remove it from ${filePath}.`,
      )
    }

    if (hasDisallowedChatBindingTableAccess(filePath, content)) {
      fail(
        `Chat Session Binding table access belongs in ${CHAT_SESSION_BINDING_OWNER}, not ${filePath}.`,
      )
    }
  }

  for (const transport of CHAT_SESSION_BINDING_TRANSPORTS) {
    const content = readText(transport)
    if (hasTransportBindingAtomAccess(content)) {
      fail(
        `${transport} must consume an injected ChatSessionBinding and contain no subChat*AtomFamily reads or writes.`,
      )
    }
    if (hasRendererNativeSessionPayload(content)) {
      fail(
        `${transport} must not submit renderer-derived native session provenance.`,
      )
    }
  }

  for (const inputSchema of CHAT_SESSION_BINDING_INPUT_SCHEMAS) {
    if (hasNativeSessionInputSchemaField(readText(inputSchema))) {
      fail(
        `${inputSchema} must reject renderer-supplied native session provenance.`,
      )
    }
  }

  const subChatRouter = readText("src/main/lib/trpc/routers/chats-sub-chats.ts")
  if (/\bupdateSubChatSession\b/.test(subChatRouter)) {
    fail(
      "The retired updateSubChatSession route must not coexist with main-owned native session provenance.",
    )
  }

  const codexRouter = readText("src/main/lib/trpc/routers/codex.ts")
  const codexProviderBinding = readText(
    "src/main/lib/codex/desktop-run-provider-binding.ts",
  )
  const providerGateway = readText("src/main/lib/provider-profiles/gateway.ts")
  if (
    !hasCodexBoundModelCatalogPath({
      router: codexRouter,
      providerBinding: codexProviderBinding,
      gateway: providerGateway,
    })
  ) {
    fail(
      "Codex Provider Profile model discovery must remain bound to the admitted historical Chat model snapshot.",
    )
  }
}

const CHAT_MAINTENANCE_FENCE_OWNER =
  "src/main/lib/agent-runtime/chat-maintenance-fence.ts"

function assertChatMaintenanceFenceSingleOwner() {
  const owner = readText(CHAT_MAINTENANCE_FENCE_OWNER)
  const forbiddenOwnerDependencies = [
    [
      /(?:from|import\()\s*["'][^"']*(?:\/db(?:\/|["'])|db\/schema)/,
      "database",
    ],
    [/(?:from|import\()\s*["'][^"']*(?:agent-jobs|job-store)/, "agent job"],
    [/(?:from|import\()\s*["'][^"']*chat-session-binding/, "binding row"],
  ]

  for (const [pattern, label] of forbiddenOwnerDependencies) {
    if (pattern.test(owner)) {
      fail(
        `${CHAT_MAINTENANCE_FENCE_OWNER} must remain process-memory-only and cannot import a ${label} owner.`,
      )
    }
  }

  for (const stateIdentifier of [
    "maintenanceFenceBySubChat",
    "maintenanceInvalidatedAdmissions",
    "runBlockersBySubChat",
  ]) {
    const stateOwners = []
    for (const absolutePath of walkFiles("src", [".ts", ".tsx"])) {
      const filePath = relative(absolutePath)
      const content = readFileSync(absolutePath, "utf8")
      if (new RegExp(`\\b${stateIdentifier}\\b`).test(content)) {
        stateOwners.push(filePath)
      }
    }
    if (
      stateOwners.length !== 1 ||
      stateOwners[0] !== CHAT_MAINTENANCE_FENCE_OWNER
    ) {
      fail(
        `Chat maintenance fence state ${stateIdentifier} must exist only in ${CHAT_MAINTENANCE_FENCE_OWNER}; found ${stateOwners.join(", ") || "none"}.`,
      )
    }
  }

  const subChatRouter = readText("src/main/lib/trpc/routers/chats-sub-chats.ts")
  if (/\bupdateSubChatMessages\b/.test(subChatRouter)) {
    fail(
      "The retired updateSubChatMessages route must not coexist with canonical rollback.",
    )
  }
  if (/\bupdateSubChatSession\b/.test(subChatRouter)) {
    fail(
      "The retired updateSubChatSession route must not coexist with main-owned native session provenance.",
    )
  }
  for (const symbol of [
    "acquireChatMaintenanceFence",
    "releaseChatMaintenanceFence",
  ]) {
    if (!subChatRouter.includes(symbol)) {
      fail(`rollbackToMessage must use ${symbol}.`)
    }
  }

  for (const runtimeRouter of [
    "src/main/lib/trpc/routers/claude.ts",
    "src/main/lib/trpc/routers/codex.ts",
  ]) {
    const runtimeRouterSource = readText(runtimeRouter)
    for (const symbol of [
      "claimDesktopRunAdmissionWithMaintenanceFence",
      "releaseChatMaintenanceRunBlocker",
      "releaseDesktopRunAdmissionWithMaintenanceFence",
    ]) {
      if (!runtimeRouterSource.includes(symbol)) {
        fail(`${runtimeRouter} must use ${symbol} from the maintenance owner.`)
      }
    }
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

// ---------------------------------------------------------------------------
// Canonical run event ledger (refactor-canonical-run-event-ledger)
//
// The fixture-driven rules pin the ledger owners of
// docs/OWNERSHIP_MAP.md "Runtime Events, Trace, And Redaction". Their
// self-test consumes RUN_EVENT_LEDGER_ARCHITECTURE_FIXTURE_PATH, and the
// repository is always enforced in the canonical end state: every pinned
// owner defines and exports its symbol, no legacy writer/mapper symbol,
// direct agent_job_events insert, second store importer or provenance binding
// outside the host remains.
// ---------------------------------------------------------------------------

const RUN_EVENT_LEDGER_ARCHITECTURE_FIXTURE_PATH =
  "tests/fixtures/run-event-ledger/architecture-fixtures.json"
const RUN_EVENT_LEDGER_FIXTURE_FLAG = "--run-event-ledger-fixtures="
const RUN_EVENT_LEDGER_BIND_METHOD = "bindExecutionProvenance"
const RUN_EVENT_LEDGER_STORE_APPEND = "appendExactRunEventBatch"

function runEventLedgerOption(flag) {
  const argument = process.argv.find((entry) => entry.startsWith(flag))
  return argument ? argument.slice(flag.length) : null
}

function loadRunEventLedgerArchitectureFixture() {
  const fixturePath =
    runEventLedgerOption(RUN_EVENT_LEDGER_FIXTURE_FLAG) ??
    RUN_EVENT_LEDGER_ARCHITECTURE_FIXTURE_PATH
  const absolutePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(repoRoot, fixturePath)
  if (!existsSync(absolutePath)) {
    fail(`${fixturePath} is missing.`)
    return null
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"))
  } catch (error) {
    fail(`${fixturePath} is not valid JSON: ${String(error)}`)
    return null
  }
}

function collectRunEventLedgerSourceFacts(filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const facts = {
    definitions: new Set(),
    reexports: new Set(),
    identifiers: new Set(),
    exportedNames: new Set(),
    eventInsertFunctions: new Set(),
    eventInsertCount: 0,
    bindCalls: 0,
  }
  const eventTableAliases = new Set(["agentJobEvents"])
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === "agentJobEvents") {
          eventTableAliases.add(element.name.text)
        }
      }
    }
  }
  function enclosingFunctionName(node) {
    let current = node.parent
    while (current) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        return current.name.text
      }
      if (
        (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
        current.parent &&
        ts.isVariableDeclaration(current.parent) &&
        ts.isIdentifier(current.parent.name)
      ) {
        return current.parent.name.text
      }
      current = current.parent
    }
    return null
  }
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    ) {
      facts.definitions.add(node.name.text)
      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
        facts.exportedNames.add(node.name.text)
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      facts.definitions.add(node.name.text)
      const statement = node.parent?.parent
      if (
        statement &&
        ts.isVariableStatement(statement) &&
        hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      ) {
        facts.exportedNames.add(node.name.text)
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text
        if (node.moduleSpecifier) {
          facts.reexports.add(local)
        } else {
          facts.exportedNames.add(local)
        }
      }
    }
    if (ts.isIdentifier(node)) facts.identifiers.add(node.text)
    if (
      ts.isElementAccessExpression(node) &&
      stringLiteralValue(node.argumentExpression)
    ) {
      facts.identifiers.add(stringLiteralValue(node.argumentExpression))
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const calleeName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee)
          ? stringLiteralValue(callee.argumentExpression)
          : null
      if (calleeName === RUN_EVENT_LEDGER_BIND_METHOD) facts.bindCalls += 1
      if (calleeName === "insert" && node.arguments.length > 0) {
        const target = node.arguments[0]
        const targetName = ts.isIdentifier(target)
          ? target.text
          : ts.isPropertyAccessExpression(target)
            ? target.name.text
            : null
        if (targetName && eventTableAliases.has(targetName)) {
          facts.eventInsertCount += 1
          const owner = enclosingFunctionName(node)
          if (owner) facts.eventInsertFunctions.add(owner)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return facts
}

function collectRunEventLedgerFindings(files, fixture) {
  const ownerSection = fixture.ownerSection
  const pins = fixture.pinnedOwners ?? {}
  const legacySymbols = fixture.legacySymbols ?? []
  const storeOwner = pins[RUN_EVENT_LEDGER_STORE_APPEND]
  const storeImporter = fixture.storeAppendImporter
  const findings = []
  for (const { filePath, content } of files) {
    const facts = collectRunEventLedgerSourceFacts(filePath, content)
    for (const [symbol, owner] of Object.entries(pins)) {
      if (filePath === owner) continue
      if (facts.definitions.has(symbol)) {
        findings.push({
          rule: "duplicate-definition",
          file: filePath,
          symbol,
          owner,
          ownerSection,
        })
      }
      if (facts.reexports.has(symbol)) {
        findings.push({
          rule: "duplicate-reexport",
          file: filePath,
          symbol,
          owner,
          ownerSection,
        })
      }
    }
    if (
      filePath !== storeOwner &&
      filePath !== storeImporter &&
      importsNamedSymbolFrom(
        filePath,
        content,
        storeOwner,
        RUN_EVENT_LEDGER_STORE_APPEND,
      )
    ) {
      findings.push({
        rule: "forbidden-store-import",
        file: filePath,
        symbol: RUN_EVENT_LEDGER_STORE_APPEND,
        owner: storeImporter,
        ownerSection,
      })
    }
    if (filePath === storeOwner) {
      for (const name of facts.eventInsertFunctions) {
        if (
          name !== RUN_EVENT_LEDGER_STORE_APPEND &&
          facts.exportedNames.has(name)
        ) {
          findings.push({
            rule: "exported-record-insert",
            file: filePath,
            symbol: name,
            owner: storeOwner,
            ownerSection,
          })
        }
      }
    } else if (facts.eventInsertCount > 0) {
      findings.push({
        rule: "direct-event-insert",
        file: filePath,
        symbol: "agentJobEvents",
        owner: storeOwner,
        ownerSection,
      })
    }
    for (const symbol of legacySymbols) {
      if (
        facts.definitions.has(symbol) ||
        facts.reexports.has(symbol) ||
        facts.identifiers.has(symbol)
      ) {
        findings.push({
          rule: "legacy-symbol",
          file: filePath,
          symbol,
          ownerSection,
        })
      }
    }
    if (filePath !== storeImporter && facts.bindCalls > 0) {
      findings.push({
        rule: "provenance-binding-outside-host",
        file: filePath,
        symbol: RUN_EVENT_LEDGER_BIND_METHOD,
        owner: storeImporter,
        ownerSection,
      })
    }
  }
  return findings
}

function runEventLedgerFindingKey(finding) {
  return JSON.stringify(
    Object.keys(finding)
      .sort(compareCodePoints)
      .map((key) => [key, finding[key]]),
  )
}

/**
 * Fixture-driven self-test: every case's files are scanned as if they were
 * the repository files at their paths; the produced finding set must equal
 * expectedFindings exactly, so a missing or an unexpected finding fails.
 * Returns an inspectable summary.
 */
function assertRunEventLedgerGuardSelfTest(fixture) {
  const summary = { cases: 0, matched: 0, mismatches: [] }
  for (const entry of fixture?.cases ?? []) {
    summary.cases += 1
    const produced = collectRunEventLedgerFindings(entry.files ?? [], fixture)
      .map(runEventLedgerFindingKey)
      .sort(compareCodePoints)
    const expected = (entry.expectedFindings ?? [])
      .map(runEventLedgerFindingKey)
      .sort(compareCodePoints)
    const missing = expected.filter((key) => !produced.includes(key))
    const unexpected = produced.filter((key) => !expected.includes(key))
    if (missing.length === 0 && unexpected.length === 0) {
      summary.matched += 1
      continue
    }
    summary.mismatches.push({ caseId: entry.caseId, missing, unexpected })
    fail(
      `Run event ledger guard self-test case ${entry.caseId} (${entry.category}) missed ${missing.join(", ") || "nothing"} and produced unexpected ${unexpected.join(", ") || "nothing"}. See ${RUNTIME_EVENT_OWNERSHIP_SECTION}.`,
    )
  }
  if (summary.cases === 0) {
    fail(
      `${RUN_EVENT_LEDGER_ARCHITECTURE_FIXTURE_PATH} must provide run event ledger guard self-test cases.`,
    )
  }
  return summary
}

function assertRunEventLedgerOwnership(fixture) {
  const files = walkFiles("src", RUNTIME_CORE_SOURCE_EXTENSIONS).map(
    (absolutePath) => ({
      filePath: relative(absolutePath),
      content: readFileSync(absolutePath, "utf8"),
    }),
  )
  for (const [symbol, owner] of Object.entries(fixture.pinnedOwners ?? {})) {
    const ownerFile = files.find((file) => file.filePath === owner)
    const facts = ownerFile
      ? collectRunEventLedgerSourceFacts(owner, ownerFile.content)
      : null
    if (!facts?.definitions.has(symbol) || !facts.exportedNames.has(symbol)) {
      fail(
        `${symbol} must be defined and exported by ${owner}. See ${RUNTIME_EVENT_OWNERSHIP_SECTION}.`,
      )
    }
  }
  for (const finding of collectRunEventLedgerFindings(files, fixture)) {
    fail(
      `Run event ledger ${finding.rule}: ${finding.file} ${finding.symbol}${finding.owner ? ` (owner ${finding.owner})` : ""}. See ${RUNTIME_EVENT_OWNERSHIP_SECTION}.`,
    )
  }
}

function assertRunEventLedgerGuards() {
  const fixture = loadRunEventLedgerArchitectureFixture()
  if (!fixture) return
  const summary = assertRunEventLedgerGuardSelfTest(fixture)
  assertRunEventLedgerOwnership(fixture)
  console.log(
    `Run event ledger guard self-test: ${summary.matched}/${summary.cases} fixture cases matched; repository ownership enforced.`,
  )
}

// ---------------------------------------------------------------------------
// Local job API async submission (add-local-job-api-async-submit)
//
// The fixture-driven rules pin the async submission end state of
// docs/OWNERSHIP_MAP.md "Headless Agent Runtime": run-submission.ts owns
// submitRun/waitForRun, daemon.ts owns the canonical pump pumpQueuedRuns, the
// API/stdio adapters and the submit core never call a runner or the claim
// primitives themselves (only the human `locus run` keeps its in-process
// runner), only job-store.ts inserts agent_jobs rows, only the run event
// ledger host imports appendExactRunEventBatch, and no retired symbol (the old
// inline API core or the retired ledger transition gate) can come back
// through a migration toggle. Its self-test consumes
// LOCAL_JOB_API_ASYNC_ARCHITECTURE_FIXTURE_PATH and the repository is always
// enforced in that end state.
// Runner/claim calls are matched by callee name: direct, named-import alias,
// namespace or element access, and a local re-binding by a variable
// declaration (`const r = runner`, `const { startAgentJob: claim } = store`).
// Every src/main/lib/headless file except the execution owners
// (LOCAL_JOB_API_ASYNC_EXECUTION_OWNERS) is scanned besides the fixture's
// nonExecutingFiles, and a permitted caller counts only as the outermost
// top-level function of its file (a nested helper or a class method of the
// same name is not permitted). Job-row inserts match `insert(agentJobs)`
// through an import alias, a namespace member or an element access
// (`schema["agentJobs"]`).
// Detection limits (disclosed): re-binding by later assignment
// (`let r; r = runner`), indirect `.call`/`.apply`/`Reflect.apply`, a
// computed element key that is not a string literal, a re-binding through
// another module, and raw SQL `INSERT INTO agent_jobs` text are not caught.
// ---------------------------------------------------------------------------

const LOCAL_JOB_API_ASYNC_ARCHITECTURE_FIXTURE_PATH =
  "tests/fixtures/local-job-api-async/guards-protocol/architecture-fixtures.json"
const LOCAL_JOB_API_ASYNC_FIXTURE_FLAG = "--local-job-api-async-fixtures="
const LOCAL_JOB_API_ASYNC_GUARD_LABEL =
  "Local job API async submission guard self-test"
const HEADLESS_AGENT_RUNTIME_OWNERSHIP_SECTION =
  'docs/OWNERSHIP_MAP.md "Headless Agent Runtime"'
/** Headless files that own execution: they define or call runner/claim. */
const LOCAL_JOB_API_ASYNC_EXECUTION_OWNERS = new Set([
  "src/main/lib/headless/daemon.ts",
  "src/main/lib/headless/job-runner.ts",
  "src/main/lib/headless/completion-runner.ts",
  "src/main/lib/headless/job-store.ts",
])
const LOCAL_JOB_API_ASYNC_SCANNED_PREFIX = "src/main/lib/headless/"
const LOCAL_JOB_API_ASYNC_OWNERSHIP_PINS = [
  "`src/main/lib/headless/run-submission.ts#submitRun`",
  "`src/main/lib/headless/run-submission.ts#waitForRun`",
  "`src/main/lib/headless/daemon.ts#pumpQueuedRuns`",
  "`src/main/lib/headless/job-store.ts#insertQueuedAgentJobRecord`",
  "`src/main/lib/agent-runtime/run-artifacts.ts#reopenAdmittedRunDir`",
]

function loadLocalJobApiAsyncArchitectureFixture() {
  const fixturePath =
    runEventLedgerOption(LOCAL_JOB_API_ASYNC_FIXTURE_FLAG) ??
    LOCAL_JOB_API_ASYNC_ARCHITECTURE_FIXTURE_PATH
  const absolutePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(repoRoot, fixturePath)
  if (!existsSync(absolutePath)) {
    fail(`${fixturePath} is missing.`)
    return null
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"))
  } catch (error) {
    fail(`${fixturePath} is not valid JSON: ${String(error)}`)
    return null
  }
}

/**
 * Name of the outermost function-like ancestor of a node when it is a
 * top-level function of its file (a function declaration, or a function
 * expression / arrow bound by a top-level variable declaration); null for
 * a call outside any function, inside a class method, or inside a function
 * nested in another construct.
 */
function topLevelEnclosingFunctionName(node) {
  let outermost = null
  let current = node.parent
  while (current) {
    if (ts.isFunctionLike(current)) outermost = current
    current = current.parent
  }
  if (!outermost) return null
  if (
    ts.isFunctionDeclaration(outermost) &&
    outermost.name &&
    ts.isSourceFile(outermost.parent)
  ) {
    return outermost.name.text
  }
  if (
    (ts.isFunctionExpression(outermost) || ts.isArrowFunction(outermost)) &&
    outermost.parent &&
    ts.isVariableDeclaration(outermost.parent) &&
    ts.isIdentifier(outermost.parent.name) &&
    ts.isVariableDeclarationList(outermost.parent.parent) &&
    ts.isVariableStatement(outermost.parent.parent.parent) &&
    ts.isSourceFile(outermost.parent.parent.parent.parent)
  ) {
    return outermost.parent.name.text
  }
  return null
}

/** Name of a referenced member: identifier, property or literal element. */
function referencedMemberName(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) {
    return stringLiteralValue(node.argumentExpression)
  }
  return null
}

function collectLocalJobApiAsyncSourceFacts(filePath, content, fixture) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const tracked = new Set([
    ...(fixture.runnerSymbols ?? []),
    ...(fixture.claimSymbols ?? []),
  ])
  // Local binding -> imported name of tracked call symbols and agentJobs.
  const callAliases = new Map()
  const jobTableAliases = new Set(["agentJobs"])
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        const imported = (element.propertyName ?? element.name).text
        if (tracked.has(imported)) callAliases.set(element.name.text, imported)
        if (imported === "agentJobs") jobTableAliases.add(element.name.text)
      }
    }
  }
  for (const symbol of tracked) {
    if (!callAliases.has(symbol)) callAliases.set(symbol, symbol)
  }
  // Local re-bindings by declaration: `const r = runner`,
  // `const r = store.startAgentJob` and destructuring
  // `const { startAgentJob: claim } = store`.
  function collectRebindings(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const source = referencedMemberName(node.initializer)
        if (source && callAliases.has(source)) {
          callAliases.set(node.name.text, callAliases.get(source))
        }
        if (source && jobTableAliases.has(source)) {
          jobTableAliases.add(node.name.text)
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const property = element.propertyName
            ? ts.isIdentifier(element.propertyName) ||
              ts.isStringLiteral(element.propertyName)
              ? element.propertyName.text
              : null
            : element.name.text
          if (property && tracked.has(property)) {
            callAliases.set(element.name.text, property)
          }
          if (property === "agentJobs") jobTableAliases.add(element.name.text)
        }
      }
    }
    ts.forEachChild(node, collectRebindings)
  }
  collectRebindings(sourceFile)
  const calls = []
  let jobInsertCount = 0
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const calleeName = referencedMemberName(node.expression)
      if (calleeName && callAliases.has(calleeName)) {
        calls.push({
          symbol: callAliases.get(calleeName),
          topLevelFunction: topLevelEnclosingFunctionName(node),
        })
      }
      if (calleeName === "insert" && node.arguments.length > 0) {
        const targetName = referencedMemberName(node.arguments[0])
        if (targetName && jobTableAliases.has(targetName)) jobInsertCount += 1
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return {
    ...collectRunEventLedgerSourceFacts(filePath, content),
    calls,
    jobInsertCount,
  }
}

function collectLocalJobApiAsyncFindings(files, fixture) {
  const ownerSection = fixture.ownerSection
  const pins = fixture.pinnedOwners ?? {}
  const retired = fixture.retiredSymbols ?? {}
  const nonExecuting = new Set(fixture.nonExecutingFiles ?? [])
  const runnerSymbols = new Set(fixture.runnerSymbols ?? [])
  const claimSymbols = new Set(fixture.claimSymbols ?? [])
  const permitted = fixture.permittedRunnerCallers ?? []
  const findings = []
  for (const { filePath, content } of files) {
    const facts = collectLocalJobApiAsyncSourceFacts(filePath, content, fixture)
    for (const [symbol, owner] of Object.entries(pins)) {
      if (filePath === owner) continue
      if (facts.definitions.has(symbol)) {
        findings.push({
          rule: "duplicate-definition",
          file: filePath,
          symbol,
          owner,
          ownerSection,
        })
      }
      if (facts.reexports.has(symbol)) {
        findings.push({
          rule: "duplicate-reexport",
          file: filePath,
          symbol,
          owner,
          ownerSection,
        })
      }
    }
    for (const [symbol, owner] of Object.entries(retired)) {
      if (
        facts.definitions.has(symbol) ||
        facts.reexports.has(symbol) ||
        facts.identifiers.has(symbol)
      ) {
        findings.push({
          rule: "retired-symbol",
          file: filePath,
          symbol,
          owner,
          ownerSection,
        })
      }
    }
    if (
      nonExecuting.has(filePath) ||
      (filePath.startsWith(LOCAL_JOB_API_ASYNC_SCANNED_PREFIX) &&
        !LOCAL_JOB_API_ASYNC_EXECUTION_OWNERS.has(filePath))
    ) {
      const reported = new Set()
      for (const call of facts.calls) {
        const allowed = permitted.some(
          (entry) =>
            entry.file === filePath && call.topLevelFunction === entry.function,
        )
        if (allowed) continue
        const rule = runnerSymbols.has(call.symbol)
          ? "inline-runner-call"
          : claimSymbols.has(call.symbol)
            ? "independent-dispatch"
            : null
        if (!rule || reported.has(`${rule}|${call.symbol}`)) continue
        reported.add(`${rule}|${call.symbol}`)
        findings.push({
          rule,
          file: filePath,
          symbol: call.symbol,
          owner: fixture.queueOwner,
          ownerSection,
        })
      }
    }
    if (filePath !== fixture.jobRowInsertOwner && facts.jobInsertCount > 0) {
      findings.push({
        rule: "direct-job-insert",
        file: filePath,
        symbol: "agentJobs",
        owner: fixture.jobRowInsertOwner,
        ownerSection,
      })
    }
    if (
      filePath !== fixture.storeAppendOwner &&
      filePath !== fixture.storeAppendImporter &&
      importsNamedSymbolFrom(
        filePath,
        content,
        fixture.storeAppendOwner,
        RUN_EVENT_LEDGER_STORE_APPEND,
      )
    ) {
      findings.push({
        rule: "forbidden-store-import",
        file: filePath,
        symbol: RUN_EVENT_LEDGER_STORE_APPEND,
        owner: fixture.storeAppendImporter,
        ownerSection,
      })
    }
  }
  return findings
}

/**
 * Fixture-driven self-test: every case's files are scanned as if they were
 * the repository files at their paths; the produced finding set must equal
 * expectedFindings exactly (a missing or an unexpected finding fails).
 */
function assertLocalJobApiAsyncGuardSelfTest(fixture) {
  const summary = { cases: 0, matched: 0 }
  for (const entry of fixture?.cases ?? []) {
    summary.cases += 1
    const produced = collectLocalJobApiAsyncFindings(entry.files ?? [], fixture)
      .map(runEventLedgerFindingKey)
      .sort(compareCodePoints)
    const expected = (entry.expectedFindings ?? [])
      .map(runEventLedgerFindingKey)
      .sort(compareCodePoints)
    const missing = expected.filter((key) => !produced.includes(key))
    const unexpected = produced.filter((key) => !expected.includes(key))
    if (missing.length === 0 && unexpected.length === 0) {
      summary.matched += 1
      continue
    }
    fail(
      `${LOCAL_JOB_API_ASYNC_GUARD_LABEL} case ${entry.caseId} (${entry.category}) missed ${missing.join(", ") || "nothing"} and produced unexpected ${unexpected.join(", ") || "nothing"}. See ${HEADLESS_AGENT_RUNTIME_OWNERSHIP_SECTION}.`,
    )
  }
  if (summary.cases === 0) {
    fail(
      `${LOCAL_JOB_API_ASYNC_ARCHITECTURE_FIXTURE_PATH} must provide async submission guard self-test cases.`,
    )
  }
  return summary
}

function assertLocalJobApiAsyncOwnership(fixture) {
  const files = walkFiles("src", RUNTIME_CORE_SOURCE_EXTENSIONS).map(
    (absolutePath) => ({
      filePath: relative(absolutePath),
      content: readFileSync(absolutePath, "utf8"),
    }),
  )
  for (const [symbol, owner] of Object.entries(fixture.pinnedOwners ?? {})) {
    const ownerFile = files.find((file) => file.filePath === owner)
    const facts = ownerFile
      ? collectRunEventLedgerSourceFacts(owner, ownerFile.content)
      : null
    if (!facts?.definitions.has(symbol) || !facts.exportedNames.has(symbol)) {
      fail(
        `${symbol} must be defined and exported by ${owner}. See ${HEADLESS_AGENT_RUNTIME_OWNERSHIP_SECTION}.`,
      )
    }
  }
  for (const finding of collectLocalJobApiAsyncFindings(files, fixture)) {
    fail(
      `Local job API async submission ${finding.rule}: ${finding.file} ${finding.symbol}${finding.owner ? ` (owner ${finding.owner})` : ""}. See ${HEADLESS_AGENT_RUNTIME_OWNERSHIP_SECTION}.`,
    )
  }
  const ownershipMap = readText(OWNERSHIP_MAP_PATH)
  const sectionStart = ownershipMap.indexOf("## Headless Agent Runtime")
  const sectionEnd =
    sectionStart < 0 ? -1 : ownershipMap.indexOf("\n## ", sectionStart + 1)
  const section =
    sectionStart < 0
      ? ""
      : ownershipMap.slice(
          sectionStart,
          sectionEnd < 0 ? undefined : sectionEnd,
        )
  for (const pin of LOCAL_JOB_API_ASYNC_OWNERSHIP_PINS) {
    if (!section.includes(pin)) {
      fail(
        `${HEADLESS_AGENT_RUNTIME_OWNERSHIP_SECTION} must pin ${pin} as the async submission owner.`,
      )
    }
    // Every pin names a symbol its file defines and exports, so a rename or
    // a move cannot leave the ownership map stale.
    const [owner, symbol] = pin.replaceAll("`", "").split("#")
    const ownerFile = files.find((file) => file.filePath === owner)
    const facts = ownerFile
      ? collectRunEventLedgerSourceFacts(owner, ownerFile.content)
      : null
    if (!facts?.definitions.has(symbol) || !facts.exportedNames.has(symbol)) {
      fail(
        `${symbol} must be defined and exported by ${owner} (pinned in ${HEADLESS_AGENT_RUNTIME_OWNERSHIP_SECTION}).`,
      )
    }
  }
}

function assertLocalJobApiAsyncGuards() {
  const fixture = loadLocalJobApiAsyncArchitectureFixture()
  if (!fixture) return
  const summary = assertLocalJobApiAsyncGuardSelfTest(fixture)
  assertLocalJobApiAsyncOwnership(fixture)
  console.log(
    `${LOCAL_JOB_API_ASYNC_GUARD_LABEL}: ${summary.matched}/${summary.cases} fixture cases matched; repository ownership enforced.`,
  )
}

// ---------------------------------------------------------------------------
// Runtime Route Catalog Single Owner (refactor-unified-runtime-route-catalog)
//
// src/main/lib/agent-runtime/runtime-route-catalog.ts is the only owner of
// runtime -> adapter/transport/readiness selection (design D1/D2/D5). The
// fixture-driven rules below reject: a runtimeId/binding.runtime condition
// (directly or through a one-hop local predicate) or a runtime-keyed map that
// selects a leaf adapter or transport outside the catalog
// (route-dispatch-outside-owner); a second declaration table built through
// the catalog's validator or test constructor (duplicate-route-catalog); any
// retired selector module/export/import/forwarding alias
// (retired-route-selector); a value import/call of a leaf run/create export
// outside the catalog (leaf-adapter-import-outside-catalog); a production
// catalog option or query catalog argument that is not forwarded unchanged
// (route-catalog-test-port-in-production); a catalog import of Electron,
// tRPC, renderer, preload, a router (also through a one-hop wrapper) or a
// readiness -> catalog cycle (route-catalog-forbidden-dependency); a catalog
// import of the queue/ledger/artifact/provider-storage owners or a
// process.env/fs/config read (route-catalog-owner-bypass); and a renderer
// construction site or main read model that maps runtimes to transports
// itself, caches a Chat on ok:false or does not map the descriptor read
// state, any runtime discrimination inside a renderer construction path and
// any runtime-id literal or branch in the transport helper
// (renderer-route-projection-bypass); a runtime condition in main whose
// branch yields a transportId literal, and a runtime branch or
// runtime-keyed map choosing between the D1 named hosts, are
// route-dispatch-outside-owner. Its
// self-test consumes
// RUNTIME_ROUTE_CATALOG_FIXTURE_PATH (or --runtime-route-catalog-fixtures=)
// and the repository is always enforced in that end state.
// Detection limits (disclosed): runtime conditions are comparisons with a
// runtime-id string literal or a call to a same-file predicate holding one;
// leaf/transport references are matched by imported binding (named or
// namespace) and `(await import(leaf)).export`; reflection, computed keys,
// re-binding through another module and multi-hop wrappers are not caught.
// ---------------------------------------------------------------------------

const RUNTIME_ROUTE_CATALOG_FIXTURE_PATH =
  "tests/fixtures/runtime-route-catalog/architecture-fixtures.json"
const RUNTIME_ROUTE_CATALOG_FIXTURE_FLAG = "--runtime-route-catalog-fixtures="
const RUNTIME_ROUTE_CATALOG_GUARD_LABEL =
  "Runtime route catalog guard self-test"
const RUNTIME_ROUTE_CATALOG_OWNER =
  "src/main/lib/agent-runtime/runtime-route-catalog.ts"
const RUNTIME_ROUTE_CATALOG_OWNER_MODULE =
  "src/main/lib/agent-runtime/runtime-route-catalog"
const RUNTIME_ROUTE_CATALOG_SECTION = "Runtime Route Catalog Single Owner"
const RUNTIME_ROUTE_CATALOG_FINDING_FIELDS = [
  "rule",
  "file",
  "symbol",
  "owner",
  "ownerSection",
]
const RUNTIME_ROUTE_RULE = {
  dispatch: "route-dispatch-outside-owner",
  duplicate: "duplicate-route-catalog",
  retired: "retired-route-selector",
  leaf: "leaf-adapter-import-outside-catalog",
  testPort: "route-catalog-test-port-in-production",
  dependency: "route-catalog-forbidden-dependency",
  ownerBypass: "route-catalog-owner-bypass",
  renderer: "renderer-route-projection-bypass",
}
const RUNTIME_ROUTE_RUNTIME_LITERALS = new Set([
  "claude-code",
  "codex",
  "claude",
])
const RUNTIME_ROUTE_LEAF_MODULES = new Set([
  "src/main/lib/headless/adapters/claude-code",
  "src/main/lib/headless/adapters/codex",
  "src/main/lib/headless/adapters/codex-app-server",
  "src/main/lib/codex/app-server-adapter-runner",
  "src/main/lib/claude/agent-sdk-adapter-runner",
])
const RUNTIME_ROUTE_LEAF_EXPORT = /^(run|create)[A-Z]/
const RUNTIME_ROUTE_RETIRED_MODULES = new Map([
  ["src/main/lib/headless/adapter-selector", "adapter-selector"],
  ["src/main/lib/agent-runtime/runtime-registry", "runtime-registry"],
])
const RUNTIME_ROUTE_RETIRED_SYMBOLS = new Set([
  "getAgentRuntimeAdapter",
  "selectAgentRuntimeAdapter",
  "SelectAgentRuntimeAdapterOptions",
  "preferredAdapterSource",
  "DesktopRuntimeAdapterFactory",
  "resolveCodexDesktopAdapterSelection",
  "resolveCodexAppServerDesktopAdapter",
  "resolveClaudeAgentSdkDesktopAdapter",
])
/**
 * Exports of the deleted runtime-registry facade (P06) and the deleted
 * readiness dispatch facade (P18). Only the src-wide word scan rejects them,
 * so a forwarding alias under a retired name is caught; the frozen S28 clean
 * case keeps the facade name as synthetic lazy-reference text.
 */
const RUNTIME_ROUTE_RETIRED_SCAN_SYMBOLS = new Set([
  ...RUNTIME_ROUTE_RETIRED_SYMBOLS,
  "listRegisteredAgentRuntimeManifests",
  "getRegisteredAgentRuntimeManifest",
  "getRegisteredAgentRuntimeId",
  "checkRegisteredAgentRuntimeCapability",
  "resolveRegisteredAgentRuntimeManifest",
  "resolveRegisteredAgentRuntimeCapability",
  "resolveLocalJobApiRuntimeReadiness",
])
/**
 * The D1 named hosts, each with one fixed runtime (P02/P11/P12): a runtime
 * branch or runtime-keyed map choosing between them is a dispatch.
 */
const RUNTIME_ROUTE_NAMED_HOSTS = new Set([
  "runAgentTask",
  "runCodexDesktopChatRun",
  "runClaudeAgentSdkDesktopRuntimeWithMcpReadiness",
])
/** Renderer construction sites and the transport helper (P14-P16). */
const RUNTIME_ROUTE_RENDERER_SITE =
  "src/renderer/features/agents/main/active-chat"
const RUNTIME_ROUTE_RENDERER_HELPER =
  "src/renderer/features/agents/lib/runtime-route-transport"
const RUNTIME_ROUTE_RENDERER_HELPER_CALL = "createRuntimeRouteTransport"
/**
 * The renderer construction paths (P14 getOrCreateChat, P15 createNewSubChat
 * / its production handler); the innermost named declaration of every helper
 * call or transport construction joins them.
 */
const RUNTIME_ROUTE_RENDERER_CONSTRUCTION_PATHS = new Set([
  "getOrCreateChat",
  "createNewSubChat",
  "handleCreateNewSubChat",
])
/** Property names whose comparison is a runtime discrimination. */
const RUNTIME_ROUTE_RUNTIME_PROPERTIES = new Set(["runtime", "runtimeId"])
/** Query/projection functions and the index of their test-only catalog. */
const RUNTIME_ROUTE_CATALOG_ARGUMENT_INDEX = new Map([
  ["resolveRuntimeRoute", 1],
  ["listRuntimeRoutes", 1],
  ["projectRuntimeRoutes", 1],
  ["listRuntimeRouteManifests", 0],
  ["withRuntimeRouteTransportId", 1],
])
const RUNTIME_ROUTE_CATALOG_CONSTRUCTORS = new Set([
  "validateRuntimeRouteCatalog",
  "createRuntimeRouteCatalogForTests",
])
const RUNTIME_ROUTE_HOST_OPTION = "runtimeRouteCatalog"
/** Business owners the catalog must not reach (queue/ledger/artifacts/secrets). */
const RUNTIME_ROUTE_ADJACENT_OWNERS = new Map([
  ["src/main/lib/headless/job-store", "src/main/lib/headless/job-store.ts"],
  [
    "src/main/lib/agent-runtime/run-event-ledger",
    "src/main/lib/agent-runtime/run-event-ledger.ts",
  ],
  [
    "src/main/lib/agent-runtime/run-artifacts",
    "src/main/lib/agent-runtime/run-artifacts.ts",
  ],
  [
    "src/main/lib/provider-profiles/storage",
    "src/main/lib/provider-profiles/storage.ts",
  ],
])
const RUNTIME_ROUTE_FS_SPECIFIERS = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
])
const RUNTIME_ROUTE_CONFIG_SPECIFIER =
  /(claude-config|user-data-path|electron-store)/
const RUNTIME_ROUTE_READINESS_MODULE = "src/main/lib/headless/runtime-readiness"
const RUNTIME_ROUTE_TRANSPORT_ID_LITERAL = /(^[a-z0-9-]+-ipc$|transport)/
/** A transportId is a kebab-case id (no prose such as error messages). */
const RUNTIME_ROUTE_TRANSPORT_ID_SHAPE = /^[a-z0-9][a-z0-9-]*$/
/** Production scan scope (design D5): selection-adjacent main and renderer. */
const RUNTIME_ROUTE_SCANNED_DIRECTORIES = [
  "src/main/lib/agent-runtime",
  "src/main/lib/headless",
  "src/main/lib/codex",
  "src/main/lib/claude",
  "src/main/lib/trpc",
  "src/renderer/features/agents/lib",
]
const RUNTIME_ROUTE_SCANNED_FILES = [
  "src/renderer/features/agents/main/active-chat.tsx",
  "src/main/lib/chat-session-binding.ts",
  "src/main/lib/desktop-agent-jobs.ts",
]
const RUNTIME_ROUTE_CATALOG_PINNED_EXPORTS = [
  "validateRuntimeRouteCatalog",
  "createRuntimeRouteCatalogForTests",
  "resolveRuntimeRoute",
  "listRuntimeRoutes",
  "projectRuntimeRoutes",
  "probeRuntimeRouteReadiness",
]
const RUNTIME_ROUTE_PATH_FLAG =
  /LOCUS_[A-Z0-9_]*(ROUTE|SELECTOR|DUAL_PATH)[A-Z0-9_]*/

function runtimeRouteModuleKey(filePath) {
  let key = filePath.replaceAll("\\", "/")
  for (const extension of RUNTIME_CORE_SOURCE_EXTENSIONS) {
    if (key.endsWith(extension)) {
      key = key.slice(0, -extension.length)
      break
    }
  }
  if (key.endsWith("/index")) key = key.slice(0, -"/index".length)
  return key
}

/** Repo-relative module key of a relative/src specifier, else null. */
function runtimeRouteResolveSpecifier(filePath, specifier) {
  const target = specifier.replace(/[?#].*$/, "")
  let resolved = null
  if (target.startsWith(".")) {
    resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(filePath), target),
    )
  } else if (target.startsWith("src/")) {
    resolved = path.posix.normalize(target)
  }
  return resolved ? runtimeRouteModuleKey(resolved) : null
}

function runtimeRouteFinding(
  rule,
  file,
  symbol,
  owner = RUNTIME_ROUTE_CATALOG_OWNER,
) {
  return {
    rule,
    file,
    symbol,
    owner,
    ownerSection: RUNTIME_ROUTE_CATALOG_SECTION,
  }
}

function runtimeRouteParse(filePath, source) {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function runtimeRouteVisit(node, visitor) {
  visitor(node)
  ts.forEachChild(node, (child) => runtimeRouteVisit(child, visitor))
}

function runtimeRouteStringValue(expression) {
  const unwrapped = unwrapExpression(expression)
  return unwrapped && ts.isStringLiteralLike(unwrapped) ? unwrapped.text : null
}

function isRuntimeRouteDynamicImport(node) {
  return (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0])
  )
}

/**
 * Import facts of one file: value/type imports with their imported and local
 * names, namespace imports, re-exports and dynamic imports.
 */
function collectRuntimeRouteImports(filePath, sourceFile) {
  const imports = []
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const specifier = statement.moduleSpecifier.text
      const clause = statement.importClause
      const declarationTypeOnly = Boolean(clause?.isTypeOnly)
      const entry = {
        specifier,
        key: runtimeRouteResolveSpecifier(filePath, specifier),
        typeOnly: declarationTypeOnly,
        named: [],
        namespaces: [],
        hasValue: !clause,
      }
      if (clause?.name && !declarationTypeOnly) {
        entry.named.push({ imported: "default", local: clause.name.text })
        entry.hasValue = true
      }
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings) && !declarationTypeOnly) {
        entry.namespaces.push(bindings.name.text)
        entry.hasValue = true
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (declarationTypeOnly || element.isTypeOnly) continue
          entry.named.push({
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
          })
          entry.hasValue = true
        }
      }
      imports.push(entry)
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      !statement.isTypeOnly
    ) {
      const specifier = statement.moduleSpecifier.text
      const entry = {
        specifier,
        key: runtimeRouteResolveSpecifier(filePath, specifier),
        typeOnly: false,
        named: [],
        namespaces: [],
        hasValue: true,
        reexport: true,
      }
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue
          entry.named.push({
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
          })
        }
      }
      imports.push(entry)
    }
  }
  runtimeRouteVisit(sourceFile, (node) => {
    if (!isRuntimeRouteDynamicImport(node)) return
    const specifier = node.arguments[0].text
    const entry = {
      specifier,
      key: runtimeRouteResolveSpecifier(filePath, specifier),
      typeOnly: false,
      named: [],
      namespaces: [],
      hasValue: true,
      dynamic: true,
    }
    // `(await import(leaf)).member` binds the member as the used export.
    let current = node.parent
    while (
      current &&
      (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current))
    ) {
      current = current.parent
    }
    if (current && ts.isPropertyAccessExpression(current)) {
      entry.named.push({ imported: current.name.text, local: null })
    }
    imports.push(entry)
  })
  return imports
}

/** Innermost enclosing named declaration (function or const-bound function). */
function runtimeRouteEnclosingName(node) {
  let current = node.parent
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isClassDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText()
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent
    ) {
      let holder = current.parent
      while (
        holder &&
        (ts.isCallExpression(holder) ||
          ts.isParenthesizedExpression(holder) ||
          ts.isAsExpression(holder) ||
          ts.isSatisfiesExpression(holder))
      ) {
        holder = holder.parent
      }
      if (
        holder &&
        ts.isVariableDeclaration(holder) &&
        ts.isIdentifier(holder.name)
      ) {
        return holder.name.text
      }
      if (holder && ts.isPropertyAssignment(holder)) {
        const name = objectPropertyName(holder.name)
        if (name) return name
      }
    }
    current = current.parent
  }
  return "<module>"
}

const RUNTIME_ROUTE_EQUALITY_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

function isRuntimeRouteRuntimeComparison(node) {
  if (!ts.isBinaryExpression(node)) return false
  if (!RUNTIME_ROUTE_EQUALITY_OPERATORS.has(node.operatorToken.kind)) {
    return false
  }
  return [node.left, node.right].some((side) => {
    const value = runtimeRouteStringValue(side)
    return value !== null && RUNTIME_ROUTE_RUNTIME_LITERALS.has(value)
  })
}

function isRuntimeRouteRuntimeProperty(expression) {
  const value = unwrapExpression(expression)
  return Boolean(
    value &&
      ts.isPropertyAccessExpression(value) &&
      RUNTIME_ROUTE_RUNTIME_PROPERTIES.has(value.name.text),
  )
}

function isRuntimeRouteRuntimeLiteral(expression) {
  return RUNTIME_ROUTE_RUNTIME_LITERALS.has(
    runtimeRouteStringValue(expression) ?? "",
  )
}

/**
 * A node that discriminates on a runtime: a comparison with a runtime-id
 * literal or of a `.runtime` / `.runtimeId` property, a switch over either,
 * an `includes` test of either, or a call to a same-file runtime predicate.
 */
function isRuntimeRouteDiscriminant(node, predicates) {
  if (isRuntimeRouteRuntimeComparison(node)) return true
  if (
    ts.isBinaryExpression(node) &&
    RUNTIME_ROUTE_EQUALITY_OPERATORS.has(node.operatorToken.kind) &&
    (isRuntimeRouteRuntimeProperty(node.left) ||
      isRuntimeRouteRuntimeProperty(node.right))
  ) {
    return true
  }
  if (ts.isSwitchStatement(node)) {
    return (
      isRuntimeRouteSwitch(node) ||
      isRuntimeRouteRuntimeProperty(node.expression)
    )
  }
  if (!ts.isCallExpression(node)) return false
  const callee = unwrapExpression(node.expression)
  if (!callee) return false
  if (ts.isIdentifier(callee)) {
    return predicates.has(callee.text) && isRuntimeRouteConditionOperand(node)
  }
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "includes")
    return false
  if (node.arguments.some(isRuntimeRouteRuntimeProperty)) return true
  const receiver = unwrapExpression(callee.expression)
  return Boolean(
    receiver &&
      ts.isArrayLiteralExpression(receiver) &&
      receiver.elements.some(isRuntimeRouteRuntimeLiteral),
  )
}

/**
 * Whether an expression is (part of) a branch condition: an if/ternary
 * condition, a switch subject or a logical operand. A same-file predicate
 * called for its value elsewhere is not a runtime branch.
 */
function isRuntimeRouteConditionOperand(node) {
  let child = node
  let parent = node.parent
  while (parent) {
    if (ts.isIfStatement(parent)) return parent.expression === child
    if (ts.isConditionalExpression(parent)) return parent.condition === child
    if (ts.isSwitchStatement(parent)) return parent.expression === child
    if (
      ts.isBinaryExpression(parent) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(parent.operatorToken.kind)
    ) {
      return true
    }
    if (
      !ts.isParenthesizedExpression(parent) &&
      !ts.isPrefixUnaryExpression(parent) &&
      !ts.isAsExpression(parent) &&
      !ts.isNonNullExpression(parent)
    ) {
      return false
    }
    child = parent
    parent = parent.parent
  }
  return false
}

/** A runtime-id string literal or a runtime-id property key/access name. */
function isRuntimeRouteRuntimeIdToken(node) {
  if (ts.isStringLiteralLike(node)) {
    return RUNTIME_ROUTE_RUNTIME_LITERALS.has(node.text)
  }
  if (
    !ts.isIdentifier(node) ||
    !RUNTIME_ROUTE_RUNTIME_LITERALS.has(node.text)
  ) {
    return false
  }
  const parent = node.parent
  return Boolean(
    parent &&
      (ts.isPropertyAssignment(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isShorthandPropertyAssignment(parent) ||
        ts.isPropertyAccessExpression(parent) ||
        ts.isMethodDeclaration(parent)) &&
      parent.name === node,
  )
}

/** A transportId-shaped literal in a value-yielding position. */
function isRuntimeRouteYieldedTransportId(node) {
  if (
    !ts.isStringLiteralLike(node) ||
    !RUNTIME_ROUTE_TRANSPORT_ID_SHAPE.test(node.text) ||
    !RUNTIME_ROUTE_TRANSPORT_ID_LITERAL.test(node.text)
  ) {
    return false
  }
  let child = node
  let parent = node.parent
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent))
  ) {
    child = parent
    parent = parent.parent
  }
  if (!parent) return false
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind
    return (
      operator === ts.SyntaxKind.EqualsToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    )
  }
  return (
    ts.isReturnStatement(parent) ||
    ts.isArrowFunction(parent) ||
    (ts.isConditionalExpression(parent) && parent.condition !== child) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === child) ||
    (ts.isVariableDeclaration(parent) && parent.initializer === child)
  )
}

/**
 * The finding symbol of a node: its innermost named function, else the
 * module-level variable it initialises, else "<module>".
 */
function runtimeRouteDeclarationSymbol(node) {
  const name = runtimeRouteEnclosingName(node)
  if (name !== "<module>") return name
  let current = node.parent
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return name
}

/**
 * A reference to a D1 named host by name: an identifier that is not a
 * declaration or property key, or a `.host` member access (including
 * `(await import(module)).host`).
 */
function isRuntimeRouteNamedHostReference(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return RUNTIME_ROUTE_NAMED_HOSTS.has(node.name.text)
  }
  if (!ts.isIdentifier(node) || !RUNTIME_ROUTE_NAMED_HOSTS.has(node.text)) {
    return false
  }
  const parent = node.parent
  return !(
    parent &&
    (ts.isFunctionDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent)) &&
    parent.name === node
  )
}

/** Name of a function declaration or a const bound to a (wrapped) function. */
function runtimeRouteDeclaredFunctionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    runtimeRouteContains(
      node.initializer,
      (child) => ts.isArrowFunction(child) || ts.isFunctionExpression(child),
    )
  ) {
    return node.name.text
  }
  return null
}

function runtimeRouteContains(node, predicate) {
  let found = false
  runtimeRouteVisit(node, (child) => {
    if (!found && predicate(child)) found = true
  })
  return found
}

/** Same-file functions whose body compares a runtime id (one-hop wrapper). */
function collectRuntimeRoutePredicates(sourceFile) {
  const predicates = new Set()
  runtimeRouteVisit(sourceFile, (node) => {
    let name = null
    let body = null
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      name = node.name.text
      body = node.body
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer)
      if (
        initializer &&
        (ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer))
      ) {
        name = node.name.text
        body = initializer.body
      }
    }
    if (
      name &&
      body &&
      runtimeRouteContains(body, isRuntimeRouteRuntimeComparison)
    ) {
      predicates.add(name)
    }
  })
  return predicates
}

function isRuntimeRouteCondition(expression, predicates) {
  return runtimeRouteContains(
    expression,
    (node) =>
      isRuntimeRouteRuntimeComparison(node) ||
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        predicates.has(node.expression.text)),
  )
}

function isRuntimeRouteSwitch(node) {
  return node.caseBlock.clauses.some((clause) => {
    if (!ts.isCaseClause(clause)) return false
    const value = runtimeRouteStringValue(clause.expression)
    return value !== null && RUNTIME_ROUTE_RUNTIME_LITERALS.has(value)
  })
}

/**
 * Forwarded unchanged = `undefined`, a binding or property named
 * runtimeRouteCatalog, a parameter of an enclosing function, or a local
 * const initialised by such an expression.
 */
function isRuntimeRouteForwarded(expression, sourceFile, depth = 0) {
  const value = unwrapExpression(expression)
  if (!value) return false
  if (ts.isIdentifier(value)) {
    if (
      value.text === "undefined" ||
      value.text === RUNTIME_ROUTE_HOST_OPTION
    ) {
      return true
    }
    let current = value.parent
    while (current) {
      if (ts.isFunctionLike(current)) {
        const names = new Set()
        for (const parameter of current.parameters ?? []) {
          collectBindingNames(parameter.name, names)
        }
        if (names.has(value.text)) return true
      }
      current = current.parent
    }
    if (depth > 2) return false
    const declarations = []
    runtimeRouteVisit(sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === value.text
      ) {
        declarations.push(node)
      }
    })
    return (
      declarations.length > 0 &&
      declarations.every(
        (declaration) =>
          declaration.initializer &&
          isRuntimeRouteForwarded(
            declaration.initializer,
            sourceFile,
            depth + 1,
          ),
      )
    )
  }
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === RUNTIME_ROUTE_HOST_OPTION
  }
  return false
}

function runtimeRouteCalleeName(call) {
  const callee = unwrapExpression(call.expression)
  if (!callee) return null
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

function runtimeRouteModuleSource(key, fileSources, readRepository) {
  for (const extension of ["", ...RUNTIME_CORE_SOURCE_EXTENSIONS]) {
    if (fileSources.has(`${key}${extension}`)) {
      return fileSources.get(`${key}${extension}`)
    }
    for (const index of ["", "/index"]) {
      const candidate = `${key}${index}${extension}`
      if (fileSources.has(candidate)) return fileSources.get(candidate)
    }
  }
  if (!readRepository) return null
  for (const extension of RUNTIME_CORE_SOURCE_EXTENSIONS) {
    for (const candidate of [
      `${key}${extension}`,
      `${key}/index${extension}`,
    ]) {
      const absolutePath = path.join(repoRoot, candidate)
      if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
        return readFileSync(absolutePath, "utf8")
      }
    }
  }
  return null
}

function runtimeRouteForbiddenTarget(specifier, key) {
  if (specifier === "electron" || specifier.startsWith("electron/")) return true
  if (
    specifier === "@trpc" ||
    specifier.startsWith("@trpc/") ||
    specifier === "trpc-electron" ||
    specifier.startsWith("trpc-electron/") ||
    specifier.startsWith("@/")
  ) {
    return true
  }
  return Boolean(
    key &&
      (key.startsWith("src/renderer/") ||
        key.startsWith("src/preload/") ||
        key === "src/preload" ||
        key.startsWith("src/main/lib/trpc/")),
  )
}

/**
 * Every Runtime Route Catalog Single Owner finding for a set of
 * `{file, source}` entries. `readRepository` lets a one-hop wrapper check
 * read a module that is not in the set (repository mode).
 */
function collectRuntimeRouteCatalogFindings(
  files,
  { readRepository = false } = {},
) {
  const findings = []
  const seen = new Set()
  const add = (finding) => {
    const key = findingKey(finding, RUNTIME_ROUTE_CATALOG_FINDING_FIELDS)
    if (seen.has(key)) return
    seen.add(key)
    findings.push(finding)
  }
  const fileSources = new Map(files.map((entry) => [entry.file, entry.source]))
  for (const { file, source } of files) {
    const moduleKey = runtimeRouteModuleKey(file)
    const isCatalog = moduleKey === RUNTIME_ROUTE_CATALOG_OWNER_MODULE
    const sourceFile = runtimeRouteParse(file, source)
    const imports = collectRuntimeRouteImports(file, sourceFile)

    // retired-route-selector: restored module, or any retired symbol.
    if (RUNTIME_ROUTE_RETIRED_MODULES.has(moduleKey)) {
      add(
        runtimeRouteFinding(
          RUNTIME_ROUTE_RULE.retired,
          file,
          RUNTIME_ROUTE_RETIRED_MODULES.get(moduleKey),
        ),
      )
    }
    runtimeRouteVisit(sourceFile, (node) => {
      if (
        ts.isIdentifier(node) &&
        RUNTIME_ROUTE_RETIRED_SYMBOLS.has(node.text)
      ) {
        add(runtimeRouteFinding(RUNTIME_ROUTE_RULE.retired, file, node.text))
      }
    })

    if (isCatalog) {
      for (const entry of imports) {
        if (!entry.hasValue) continue
        if (runtimeRouteForbiddenTarget(entry.specifier, entry.key)) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.dependency,
              file,
              entry.specifier,
            ),
          )
          continue
        }
        if (RUNTIME_ROUTE_FS_SPECIFIERS.has(entry.specifier)) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.ownerBypass,
              file,
              entry.specifier,
            ),
          )
          continue
        }
        if (RUNTIME_ROUTE_CONFIG_SPECIFIER.test(entry.specifier)) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.ownerBypass,
              file,
              entry.specifier,
            ),
          )
          continue
        }
        const adjacentOwner = entry.key
          ? RUNTIME_ROUTE_ADJACENT_OWNERS.get(entry.key)
          : undefined
        if (adjacentOwner) {
          for (const imported of entry.named) {
            add(
              runtimeRouteFinding(
                RUNTIME_ROUTE_RULE.ownerBypass,
                file,
                imported.imported,
                adjacentOwner,
              ),
            )
          }
          for (const namespace of entry.namespaces) {
            add(
              runtimeRouteFinding(
                RUNTIME_ROUTE_RULE.ownerBypass,
                file,
                namespace,
                adjacentOwner,
              ),
            )
          }
          continue
        }
        // A router reached through a one-hop wrapper module.
        if (entry.key && !entry.dynamic && entry.key.startsWith("src/")) {
          const wrapperSource = runtimeRouteModuleSource(
            entry.key,
            fileSources,
            readRepository,
          )
          if (wrapperSource) {
            const wrapperFile = `${entry.key}.ts`
            const wrapperImports = collectRuntimeRouteImports(
              wrapperFile,
              runtimeRouteParse(wrapperFile, wrapperSource),
            )
            if (
              wrapperImports.some(
                (wrapped) =>
                  wrapped.hasValue &&
                  wrapped.key?.startsWith("src/main/lib/trpc/"),
              )
            ) {
              add(
                runtimeRouteFinding(
                  RUNTIME_ROUTE_RULE.dependency,
                  file,
                  entry.specifier,
                ),
              )
            }
          }
        }
      }
      runtimeRouteVisit(sourceFile, (node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "process" &&
          node.name.text === "env"
        ) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.ownerBypass,
              file,
              "process.env",
            ),
          )
        }
      })
      continue
    }

    // readiness -> catalog cycle.
    if (moduleKey === RUNTIME_ROUTE_READINESS_MODULE) {
      for (const entry of imports) {
        if (
          entry.hasValue &&
          entry.key === RUNTIME_ROUTE_CATALOG_OWNER_MODULE
        ) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.dependency,
              file,
              entry.specifier,
            ),
          )
        }
      }
    }

    // Leaf exports, transport classes and catalog constructors in scope.
    const targets = new Set()
    const leafNamespaces = new Set()
    for (const entry of imports) {
      if (!entry.hasValue || !entry.key) continue
      if (RUNTIME_ROUTE_LEAF_MODULES.has(entry.key)) {
        for (const imported of entry.named) {
          if (!RUNTIME_ROUTE_LEAF_EXPORT.test(imported.imported)) continue
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.leaf,
              file,
              imported.imported,
            ),
          )
          if (imported.local) targets.add(imported.local)
        }
        for (const namespace of entry.namespaces) leafNamespaces.add(namespace)
      }
      // D1 named hosts imported under an alias are dispatch targets too.
      for (const imported of entry.named) {
        if (
          RUNTIME_ROUTE_NAMED_HOSTS.has(imported.imported) &&
          imported.local
        ) {
          targets.add(imported.local)
        }
      }
      if (entry.key.endsWith("-chat-transport")) {
        for (const imported of entry.named) {
          if (/ChatTransport$/.test(imported.imported) && imported.local) {
            targets.add(imported.local)
          }
        }
      }
      if (entry.key === RUNTIME_ROUTE_CATALOG_OWNER_MODULE) {
        for (const imported of entry.named) {
          if (RUNTIME_ROUTE_CATALOG_CONSTRUCTORS.has(imported.imported)) {
            add(
              runtimeRouteFinding(
                RUNTIME_ROUTE_RULE.duplicate,
                file,
                imported.imported,
              ),
            )
          }
        }
      }
    }
    runtimeRouteVisit(sourceFile, (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        leafNamespaces.has(node.expression.text) &&
        RUNTIME_ROUTE_LEAF_EXPORT.test(node.name.text)
      ) {
        add(runtimeRouteFinding(RUNTIME_ROUTE_RULE.leaf, file, node.name.text))
      }
    })
    const isRendererSite = moduleKey === RUNTIME_ROUTE_RENDERER_SITE
    const isRendererHelper = moduleKey === RUNTIME_ROUTE_RENDERER_HELPER
    if (isRendererSite) targets.add(RUNTIME_ROUTE_RENDERER_HELPER_CALL)
    const dispatchRule =
      isRendererSite || isRendererHelper
        ? RUNTIME_ROUTE_RULE.renderer
        : RUNTIME_ROUTE_RULE.dispatch
    const isTarget = (node) =>
      (ts.isIdentifier(node) &&
        targets.has(node.text) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        )) ||
      (ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        leafNamespaces.has(node.expression.text) &&
        RUNTIME_ROUTE_LEAF_EXPORT.test(node.name.text)) ||
      isRuntimeRouteNamedHostReference(node)
    const predicates = collectRuntimeRoutePredicates(sourceFile)

    runtimeRouteVisit(sourceFile, (node) => {
      // route-dispatch-outside-owner / renderer bypass: runtime branches.
      if (
        ts.isIfStatement(node) &&
        isRuntimeRouteCondition(node.expression, predicates)
      ) {
        if (
          runtimeRouteContains(node.thenStatement, isTarget) ||
          (node.elseStatement &&
            runtimeRouteContains(node.elseStatement, isTarget))
        ) {
          add(
            runtimeRouteFinding(
              dispatchRule,
              file,
              runtimeRouteEnclosingName(node),
            ),
          )
        }
      } else if (
        ts.isConditionalExpression(node) &&
        isRuntimeRouteCondition(node.condition, predicates)
      ) {
        if (
          runtimeRouteContains(node.whenTrue, isTarget) ||
          runtimeRouteContains(node.whenFalse, isTarget)
        ) {
          add(
            runtimeRouteFinding(
              dispatchRule,
              file,
              runtimeRouteEnclosingName(node),
            ),
          )
        }
      } else if (ts.isSwitchStatement(node) && isRuntimeRouteSwitch(node)) {
        if (runtimeRouteContains(node.caseBlock, isTarget)) {
          add(
            runtimeRouteFinding(
              dispatchRule,
              file,
              runtimeRouteEnclosingName(node),
            ),
          )
        }
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        // Runtime-keyed maps.
        const initializer = unwrapExpression(node.initializer)
        if (initializer && ts.isObjectLiteralExpression(initializer)) {
          const runtimeKeyed = initializer.properties.some((property) => {
            const name = property.name && objectPropertyName(property.name)
            return (
              name !== null &&
              name !== undefined &&
              RUNTIME_ROUTE_RUNTIME_LITERALS.has(name)
            )
          })
          if (runtimeKeyed) {
            if (runtimeRouteContains(initializer, isTarget)) {
              add(runtimeRouteFinding(dispatchRule, file, node.name.text))
            } else if (
              file.startsWith("src/main/") &&
              initializer.properties.some(
                (property) =>
                  ts.isPropertyAssignment(property) &&
                  RUNTIME_ROUTE_TRANSPORT_ID_LITERAL.test(
                    runtimeRouteStringValue(property.initializer) ?? "",
                  ),
              )
            ) {
              add(
                runtimeRouteFinding(
                  RUNTIME_ROUTE_RULE.renderer,
                  file,
                  node.name.text,
                ),
              )
            }
          }
        }
      }

      // route-catalog-test-port-in-production.
      if (
        ts.isPropertyAssignment(node) &&
        objectPropertyName(node.name) === RUNTIME_ROUTE_HOST_OPTION &&
        ts.isObjectLiteralExpression(node.parent) &&
        !isRuntimeRouteForwarded(node.initializer, sourceFile)
      ) {
        add(
          runtimeRouteFinding(
            RUNTIME_ROUTE_RULE.testPort,
            file,
            RUNTIME_ROUTE_HOST_OPTION,
          ),
        )
      }
      if (ts.isCallExpression(node)) {
        const callee = runtimeRouteCalleeName(node)
        const index = callee
          ? RUNTIME_ROUTE_CATALOG_ARGUMENT_INDEX.get(callee)
          : undefined
        if (
          index !== undefined &&
          node.arguments.length > index &&
          !isRuntimeRouteForwarded(node.arguments[index], sourceFile)
        ) {
          add(runtimeRouteFinding(RUNTIME_ROUTE_RULE.testPort, file, callee))
        }
      }
    })

    // renderer-route-projection-bypass: the transport helper maps
    // transportIds only; any runtime-id literal or runtime branch is a bypass.
    if (isRendererHelper) {
      runtimeRouteVisit(sourceFile, (node) => {
        if (
          isRuntimeRouteRuntimeIdToken(node) ||
          isRuntimeRouteDiscriminant(node, predicates)
        ) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.renderer,
              file,
              runtimeRouteDeclarationSymbol(node),
            ),
          )
        }
      })
    }

    // renderer-route-projection-bypass: a runtime condition (ternary, if,
    // switch or logical operator) whose branch yields a transportId literal
    // is a runtimeId -> transportId literal mapping outside the catalog
    // (design D5), in every syntactic form, in main and on the renderer
    // construction site (including a same-file value wrapper).
    if (file.startsWith("src/main/") || isRendererSite) {
      const discriminates = (expression) =>
        runtimeRouteContains(expression, (child) =>
          isRuntimeRouteDiscriminant(child, predicates),
        )
      const yieldsTransportId = (branch) =>
        Boolean(branch) &&
        runtimeRouteContains(branch, isRuntimeRouteYieldedTransportId)
      runtimeRouteVisit(sourceFile, (node) => {
        let selectsTransport = false
        if (ts.isConditionalExpression(node)) {
          selectsTransport =
            discriminates(node.condition) &&
            (yieldsTransportId(node.whenTrue) ||
              yieldsTransportId(node.whenFalse))
        } else if (ts.isIfStatement(node)) {
          selectsTransport =
            discriminates(node.expression) &&
            (yieldsTransportId(node.thenStatement) ||
              yieldsTransportId(node.elseStatement))
        } else if (ts.isSwitchStatement(node)) {
          selectsTransport =
            isRuntimeRouteDiscriminant(node, predicates) &&
            yieldsTransportId(node.caseBlock)
        } else if (
          ts.isBinaryExpression(node) &&
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(node.operatorToken.kind)
        ) {
          selectsTransport =
            discriminates(node.left) && yieldsTransportId(node.right)
        }
        if (selectsTransport) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.renderer,
              file,
              runtimeRouteDeclarationSymbol(node),
            ),
          )
        }
      })
    }

    if (isRendererSite) {
      // Any runtime discrimination inside a construction path (P14/P15).
      const constructionPaths = new Set(
        RUNTIME_ROUTE_RENDERER_CONSTRUCTION_PATHS,
      )
      runtimeRouteVisit(sourceFile, (node) => {
        if (
          (ts.isCallExpression(node) &&
            runtimeRouteCalleeName(node) ===
              RUNTIME_ROUTE_RENDERER_HELPER_CALL) ||
          (ts.isNewExpression(node) && isTarget(node.expression))
        ) {
          const name = runtimeRouteEnclosingName(node)
          if (name !== "<module>") constructionPaths.add(name)
        }
      })
      runtimeRouteVisit(sourceFile, (node) => {
        const name = runtimeRouteDeclaredFunctionName(node)
        if (
          name &&
          constructionPaths.has(name) &&
          runtimeRouteContains(node, (child) =>
            isRuntimeRouteDiscriminant(child, predicates),
          )
        ) {
          add(runtimeRouteFinding(RUNTIME_ROUTE_RULE.renderer, file, name))
        }
      })

      const helperCalls = []
      const states = new Set()
      runtimeRouteVisit(sourceFile, (node) => {
        if (
          ts.isCallExpression(node) &&
          runtimeRouteCalleeName(node) === RUNTIME_ROUTE_RENDERER_HELPER_CALL
        ) {
          helperCalls.push(node)
        }
        if (ts.isObjectLiteralExpression(node)) {
          for (const property of node.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              objectPropertyName(property.name) === "state"
            ) {
              const value = runtimeRouteStringValue(property.initializer)
              if (value) states.add(value)
            }
          }
        }
        // A Chat cached or constructed on a failed descriptor.
        if (ts.isIfStatement(node)) {
          const condition = unwrapExpression(node.expression)
          const failedRoute =
            (ts.isPrefixUnaryExpression(condition) &&
              condition.operator === ts.SyntaxKind.ExclamationToken &&
              ts.isPropertyAccessExpression(
                unwrapExpression(condition.operand),
              ) &&
              unwrapExpression(condition.operand).name.text === "ok") ||
            (ts.isBinaryExpression(condition) &&
              ts.isPropertyAccessExpression(unwrapExpression(condition.left)) &&
              unwrapExpression(condition.left).name.text === "ok" &&
              condition.right.kind === ts.SyntaxKind.FalseKeyword)
          if (
            failedRoute &&
            runtimeRouteContains(
              node.thenStatement,
              (child) =>
                (ts.isNewExpression(child) &&
                  ts.isIdentifier(child.expression) &&
                  child.expression.text === "Chat") ||
                (ts.isCallExpression(child) &&
                  ts.isPropertyAccessExpression(child.expression) &&
                  child.expression.name.text === "set"),
            )
          ) {
            add(
              runtimeRouteFinding(
                RUNTIME_ROUTE_RULE.renderer,
                file,
                runtimeRouteEnclosingName(node),
              ),
            )
          }
        }
      })
      // The read state must map loaded / not-loaded / error descriptors.
      if (
        helperCalls.length > 0 &&
        !["loaded", "not-loaded", "error"].every((state) => states.has(state))
      ) {
        for (const call of helperCalls) {
          add(
            runtimeRouteFinding(
              RUNTIME_ROUTE_RULE.renderer,
              file,
              runtimeRouteEnclosingName(call),
            ),
          )
        }
      }
    }
  }
  return sortFindings(findings, RUNTIME_ROUTE_CATALOG_FINDING_FIELDS)
}

/**
 * The src-wide retired-name word scan of one file: every retired selector,
 * registry or readiness-facade name it mentions (any import, call, export or
 * forwarding alias), as retired-route-selector findings.
 */
function collectRuntimeRouteRetiredMentions(file, content) {
  const findings = []
  for (const symbol of RUNTIME_ROUTE_RETIRED_SCAN_SYMBOLS) {
    if (new RegExp(`\\b${symbol}\\b`).test(content)) {
      findings.push(
        runtimeRouteFinding(RUNTIME_ROUTE_RULE.retired, file, symbol),
      )
    }
  }
  return findings
}

function loadRuntimeRouteCatalogArchitectureFixture() {
  const fixturePath =
    runEventLedgerOption(RUNTIME_ROUTE_CATALOG_FIXTURE_FLAG) ??
    RUNTIME_ROUTE_CATALOG_FIXTURE_PATH
  const absolutePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(repoRoot, fixturePath)
  if (!existsSync(absolutePath)) {
    fail(`${fixturePath} is missing. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`)
    return null
  }
  let fixture
  try {
    fixture = JSON.parse(readFileSync(absolutePath, "utf8"))
  } catch (error) {
    fail(
      `${fixturePath} is not valid JSON: ${String(error)}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
    return null
  }
  // Any non-empty set of /^S\d\d$/ keys, each {cases:[...]} in the D5 case
  // shape (red-receipt 9 P2-1); header keys sit beside them.
  const scenarioKeys = Object.keys(fixture ?? {})
    .filter((key) => /^S\d\d$/.test(key))
    .sort(compareCodePoints)
  const illegal = (reason) => {
    fail(
      `${fixturePath} is not a legal runtime route catalog guard fixture: ${reason}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
    return null
  }
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    return illegal("the fixture is not an object")
  }
  if (scenarioKeys.length === 0) return illegal("no Sxx scenario key")
  const cases = []
  for (const key of scenarioKeys) {
    const scenario = fixture[key]
    if (!scenario || !Array.isArray(scenario.cases)) {
      return illegal(`${key} is not {cases:[...]}`)
    }
    for (const entry of scenario.cases) {
      const legalCase =
        entry &&
        typeof entry.caseId === "string" &&
        Array.isArray(entry.files) &&
        entry.files.every(
          (item) =>
            item &&
            typeof item.file === "string" &&
            typeof item.source === "string",
        ) &&
        Array.isArray(entry.expectedFindings) &&
        entry.expectedFindings.every(
          (finding) =>
            finding &&
            RUNTIME_ROUTE_CATALOG_FINDING_FIELDS.every(
              (field) => typeof finding[field] === "string",
            ) &&
            Object.keys(finding).length ===
              RUNTIME_ROUTE_CATALOG_FINDING_FIELDS.length,
        )
      if (!legalCase)
        return illegal(`${key} has a case outside the D5 case shape`)
      cases.push(entry)
    }
  }
  if (cases.length === 0) return illegal("no fixture cases")
  return { fixturePath, cases }
}

function runtimeRouteCatalogFindingLabel(finding) {
  return JSON.stringify(
    RUNTIME_ROUTE_CATALOG_FINDING_FIELDS.map((field) => finding[field]),
  )
}

/**
 * Fixture-driven self-test: each case's files are scanned as if they were
 * the repository files at their paths and must produce exactly the expected
 * finding tuples. A mismatch prints one line per case and fails.
 */
function assertRuntimeRouteCatalogGuardSelfTest(loaded) {
  const summary = { cases: 0, matched: 0 }
  for (const entry of loaded.cases) {
    summary.cases += 1
    const produced = collectRuntimeRouteCatalogFindings(entry.files)
      .map(runtimeRouteCatalogFindingLabel)
      .sort(compareCodePoints)
    const expected = entry.expectedFindings
      .map(runtimeRouteCatalogFindingLabel)
      .sort(compareCodePoints)
    const missing = expected.filter((key) => !produced.includes(key))
    const unexpected = produced.filter((key) => !expected.includes(key))
    if (missing.length === 0 && unexpected.length === 0) {
      summary.matched += 1
      continue
    }
    console.error(
      `${RUNTIME_ROUTE_CATALOG_GUARD_LABEL} case ${entry.caseId} missed ${missing.join(", ") || "nothing"} and produced unexpected ${unexpected.join(", ") || "nothing"}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
  }
  if (summary.matched !== summary.cases) {
    fail(
      `Runtime route catalog guard fixtures: ${summary.cases - summary.matched} of ${summary.cases} cases did not match (${loaded.fixturePath}). See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
  }
  return summary
}

/** Production scans (design D5 / red-receipt 8.1 "Guard"). */
function assertRuntimeRouteCatalogOwnership() {
  const failureCount = failures.length
  const scanned = new Set()
  for (const directory of RUNTIME_ROUTE_SCANNED_DIRECTORIES) {
    for (const absolutePath of walkFiles(
      directory,
      RUNTIME_CORE_SOURCE_EXTENSIONS,
    )) {
      scanned.add(relative(absolutePath))
    }
  }
  for (const file of RUNTIME_ROUTE_SCANNED_FILES) {
    if (existsSync(path.join(repoRoot, file))) scanned.add(file)
  }
  for (const [moduleKey] of RUNTIME_ROUTE_RETIRED_MODULES) {
    for (const extension of RUNTIME_CORE_SOURCE_EXTENSIONS) {
      if (existsSync(path.join(repoRoot, `${moduleKey}${extension}`))) {
        scanned.add(`${moduleKey}${extension}`)
      }
    }
  }
  const files = [...scanned].sort(compareCodePoints).map((file) => ({
    file,
    source: readFileSync(path.join(repoRoot, file), "utf8"),
  }))
  for (const finding of collectRuntimeRouteCatalogFindings(files, {
    readRepository: true,
  })) {
    fail(
      `Runtime route catalog ${finding.rule}: ${finding.file} ${finding.symbol} (owner ${finding.owner}). See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
  }

  // Retired selector symbols and path-selection flags anywhere in src.
  for (const absolutePath of walkFiles("src", RUNTIME_CORE_SOURCE_EXTENSIONS)) {
    const file = relative(absolutePath)
    const content = readFileSync(absolutePath, "utf8")
    for (const finding of collectRuntimeRouteRetiredMentions(file, content)) {
      fail(
        `Runtime route catalog ${finding.rule}: ${file} mentions ${finding.symbol}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
      )
    }
    const flag = content.match(RUNTIME_ROUTE_PATH_FLAG)
    if (flag) {
      fail(
        `Runtime route catalog dual-path flag ${flag[0]} in ${file}; no runtime route path-selection flag is allowed. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
      )
    }
  }

  // The single owner defines and exports its D1 surface.
  const catalogSource = readText(RUNTIME_ROUTE_CATALOG_OWNER)
  const facts = collectRunEventLedgerSourceFacts(
    RUNTIME_ROUTE_CATALOG_OWNER,
    catalogSource,
  )
  for (const symbol of RUNTIME_ROUTE_CATALOG_PINNED_EXPORTS) {
    if (!facts.definitions.has(symbol) || !facts.exportedNames.has(symbol)) {
      fail(
        `${symbol} must be defined and exported by ${RUNTIME_ROUTE_CATALOG_OWNER}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
      )
    }
  }

  // The renderer builds transports only through the helper at P14/P15.
  const activeChat = readText(`${RUNTIME_ROUTE_RENDERER_SITE}.tsx`)
  for (const construction of [
    "new CodexAppServerChatTransport(",
    "new IPCChatTransport(",
  ]) {
    if (activeChat.includes(construction)) {
      fail(
        `${RUNTIME_ROUTE_RENDERER_SITE}.tsx must not construct ${construction.slice(4, -1)} directly; use ${RUNTIME_ROUTE_RENDERER_HELPER_CALL}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
      )
    }
  }
  const helperCallCount = (
    activeChat.match(
      new RegExp(`${RUNTIME_ROUTE_RENDERER_HELPER_CALL}\\(`, "g"),
    ) ?? []
  ).length
  if (helperCallCount !== 2) {
    fail(
      `${RUNTIME_ROUTE_RENDERER_SITE}.tsx must call ${RUNTIME_ROUTE_RENDERER_HELPER_CALL} exactly twice (getOrCreateChat and createNewSubChat); found ${helperCallCount}. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
  }

  // The ownership map names the single owner and drops the superseded section.
  const ownershipMap = readText(OWNERSHIP_MAP_PATH)
  const sectionStart = ownershipMap.indexOf(
    `## ${RUNTIME_ROUTE_CATALOG_SECTION}`,
  )
  const sectionEnd =
    sectionStart < 0 ? -1 : ownershipMap.indexOf("\n## ", sectionStart + 3)
  const section =
    sectionStart < 0
      ? ""
      : ownershipMap.slice(
          sectionStart,
          sectionEnd < 0 ? undefined : sectionEnd,
        )
  if (!section.includes(`\`${RUNTIME_ROUTE_CATALOG_OWNER}\``)) {
    fail(
      `${OWNERSHIP_MAP_PATH} must have a "## ${RUNTIME_ROUTE_CATALOG_SECTION}" section naming \`${RUNTIME_ROUTE_CATALOG_OWNER}\`.`,
    )
  }
  if (ownershipMap.includes("## Headless Runtime Adapter Selection")) {
    fail(
      `${OWNERSHIP_MAP_PATH} must not keep the superseded "Headless Runtime Adapter Selection" section. See ${RUNTIME_ROUTE_CATALOG_SECTION}.`,
    )
  }
  return failures.length === failureCount
}

function assertRuntimeRouteCatalogGuards() {
  const loaded = loadRuntimeRouteCatalogArchitectureFixture()
  if (!loaded) return
  const summary = assertRuntimeRouteCatalogGuardSelfTest(loaded)
  const repositoryClean = assertRuntimeRouteCatalogOwnership()
  console.log(
    `${RUNTIME_ROUTE_CATALOG_GUARD_LABEL}: ${summary.matched}/${summary.cases} fixture cases matched; ${repositoryClean ? "repository ownership enforced" : "repository ownership violated"}.`,
  )
}

/**
 * Runs every architecture guard and exits non-zero on a failure. The module
 * only runs it when it is the invoked entry script, so unit probes can import
 * the pure rule collectors below without running the repository checks.
 */
function runArchitectureGuardCli() {
  if (updateArchitectureBaselines) {
    updateArchitectureBaselineRegistry()
  } else {
    const architectureBaselines = parseArchitectureBaselines()
    const committedArchitectureBaselines = [
      readCommittedArchitectureBaselines("HEAD", "committed HEAD"),
    ]
    const previousBaselineRevision = previousArchitectureBaselineRevision()
    if (previousBaselineRevision) {
      committedArchitectureBaselines.push(
        readCommittedArchitectureBaselines(
          previousBaselineRevision,
          "previous committed architecture baseline",
        ),
      )
    }
    const diffBaseSha = process.env.DIFF_BASE_SHA?.trim()
    if (diffBaseSha) {
      committedArchitectureBaselines.push(
        readCommittedArchitectureBaselines(
          diffBaseSha,
          "configured diff base",
          {
            allowMissingFile: true,
          },
        ),
      )
    }
    assertOwnershipDocs()
    assertPackageScripts()
    assertCiRunsArchitectureCheck()
    assertRuntimeCapabilitySingleOwner()
    assertEngineIdSingleOwner()
    assertGuardDecisionSingleOwner()
    assertRuntimeEventSinglePath()
    assertRunEventLedgerGuards()
    assertLocalJobApiAsyncGuards()
    assertRuntimeRouteCatalogGuards()
    assertRuntimeEventStateOwner()
    assertChatMessageModelOwner()
    assertChatSessionBindingSingleOwner()
    assertChatMaintenanceFenceSingleOwner()
    assertNoUnresolvedDangerousRouterInput()
    assertArchitectureRatchetSelfTests()
    if (architectureBaselines) {
      const comparedBaselineContents = new Set()
      for (const committed of committedArchitectureBaselines) {
        if (!committed?.baseline) continue
        const contentKey = JSON.stringify(committed.baseline)
        if (comparedBaselineContents.has(contentKey)) continue
        comparedBaselineContents.add(contentKey)
        assertArchitectureBaselineOnlyShrinks(
          architectureBaselines,
          committed.baseline,
          `Working architecture baseline against ${committed.label} ${committed.commitSha}`,
        )
      }
    }
    if (architectureBaselines) {
      assertRouteSurfaceRatchets(architectureBaselines)
      assertRuntimeCoreImportBoundary(architectureBaselines)
      assertReverseDirectionImports(architectureBaselines)
      assertReachThroughWrapperRegistry(architectureBaselines)
    }
    assertNoDeadSettingsState()
    assertCanonicalVocabularyI18n()
  }

  if (failures.length > 0) {
    console.error("Architecture guard failed:")
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log("Architecture guard passed.")
}

/** The pure Runtime Route Catalog rule collectors (implementer unit probes). */
export {
  collectRuntimeRouteCatalogFindings,
  collectRuntimeRouteRetiredMentions,
  RUNTIME_ROUTE_CATALOG_SECTION,
  RUNTIME_ROUTE_RULE,
}

function isArchitectureGuardEntry() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return (
      realpathSync(path.resolve(entry)) ===
      realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isArchitectureGuardEntry()) runArchitectureGuardCli()
