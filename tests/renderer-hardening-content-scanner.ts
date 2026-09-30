/**
 * Independent renderer raw-sink scanner used by
 * `renderer-hardening-content.test.ts` (design D1). Owned by the independent
 * test author; it does not reuse `tests/renderer-html-sinks.test.ts`, which the
 * implementer converts into the canonical guard.
 *
 * It parses every scanned source file with the TypeScript compiler API (so
 * comments and string literals are never mistaken for sinks) and reports each
 * insertion point as `{ class, file, symbol }`, where `symbol` is the nearest
 * named enclosing function/class/variable.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"

export type SinkClass =
  | "react-dangerouslySetInnerHTML"
  | "dom-html-write"
  | "dom-html-empty-clear"
  | "insertAdjacentHTML"
  | "document-write"
  | "contextual-fragment"
  | "set-html-unsafe"
  | "srcdoc"
  | "dynamic-script"
  | "script-src-assignment"
  | "remote-import"
  | "import-scripts"
  | "dependency-unsafeCSS"
  | "dependency-prerenderedHTML"
  | "html-remote-script"
  | "html-inline-script"
  | "html-inline-handler"

export interface SinkSite {
  sinkClass: SinkClass
  file: string
  symbol: string
  line: number
  valueText: string
}

export const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|html)$/

export function walkScannedFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkScannedFiles(fullPath))
    } else if (SCANNED_EXTENSIONS.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  const bare = fileName.replace(/\.txt$/, "")
  if (bare.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (bare.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (/\.(js|mjs|cjs)$/.test(bare)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function stringValue(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

function propertyNameText(
  name: ts.PropertyName | ts.MemberName,
): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text
  }
  return null
}

function enclosingSymbol(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isClassDeclaration(current) ||
        ts.isClassExpression(current) ||
        ts.isMethodDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText()
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) {
      const owner = enclosingSymbol(current)
      return owner === "<module>" ? current.name.text : owner
    }
    current = current.parent
  }
  return "<module>"
}

function isScriptCreateElement(node: ts.Expression): boolean {
  const call = unwrap(node)
  if (!ts.isCallExpression(call)) return false
  const callee = call.expression
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null
  if (name !== "createElement" && name !== "createElementNS") return false
  const tagArg = call.arguments[name === "createElementNS" ? 1 : 0]
  const tag = stringValue(tagArg)
  return tag !== null && tag.toLowerCase() === "script"
}

function isRemoteOrComputedSpecifier(arg: ts.Expression | undefined): boolean {
  if (!arg) return true
  const literal = stringValue(arg)
  if (literal === null) return true
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(literal)
}

export function scanSource(fileLabel: string, sourceText: string): SinkSite[] {
  if (fileLabel.replace(/\.txt$/, "").endsWith(".html")) {
    return scanHtml(fileLabel, sourceText)
  }
  const sourceFile = ts.createSourceFile(
    fileLabel,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileLabel),
  )
  const sites: SinkSite[] = []
  const scriptBindings = new Set<string>()

  const record = (sinkClass: SinkClass, node: ts.Node, value?: ts.Node) => {
    sites.push({
      sinkClass,
      file: fileLabel,
      symbol: enclosingSymbol(node),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      valueText: value ? value.getText() : node.getText(),
    })
  }

  const collectBindings = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const typeText = node.type?.getText() ?? ""
      if (
        /HTMLScriptElement/.test(typeText) ||
        (node.initializer && isScriptCreateElement(node.initializer))
      ) {
        scriptBindings.add(node.name.text)
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      if (/HTMLScriptElement/.test(node.type?.getText() ?? "")) {
        scriptBindings.add(node.name.text)
      }
    }
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(sourceFile)

  const visit = (node: ts.Node) => {
    // JSX attributes
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText()
      if (name === "dangerouslySetInnerHTML") {
        record("react-dangerouslySetInnerHTML", node, node.initializer)
      } else if (name === "srcDoc" || name.toLowerCase() === "srcdoc") {
        record("srcdoc", node, node.initializer)
      } else if (name === "unsafeCSS") {
        record("dependency-unsafeCSS", node, node.initializer)
      } else if (name === "prerenderedHTML") {
        record("dependency-prerenderedHTML", node, node.initializer)
      }
    }
    // JSX <script>
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === "script"
    ) {
      record("dynamic-script", node)
    }
    // Object literal properties
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      const name = propertyNameText(node.name)
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.name
      if (name === "dangerouslySetInnerHTML") {
        record("react-dangerouslySetInnerHTML", node, value)
      } else if (name === "innerHTML" || name === "outerHTML") {
        const literal = stringValue(value)
        record(
          literal === "" ? "dom-html-empty-clear" : "dom-html-write",
          node,
          value,
        )
      } else if (name === "srcdoc" || name === "srcDoc") {
        record("srcdoc", node, value)
      } else if (name === "unsafeCSS") {
        record("dependency-unsafeCSS", node, value)
      } else if (name === "prerenderedHTML") {
        record("dependency-prerenderedHTML", node, value)
      }
    }
    // Assignments
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = unwrap(node.left)
      let member: string | null = null
      let receiver: ts.Expression | null = null
      if (ts.isPropertyAccessExpression(target)) {
        member = target.name.text
        receiver = unwrap(target.expression)
      } else if (ts.isElementAccessExpression(target)) {
        member = stringValue(target.argumentExpression)
        receiver = unwrap(target.expression)
      }
      if (member === "innerHTML" || member === "outerHTML") {
        const literal = stringValue(unwrap(node.right))
        record(
          literal === "" &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            ? "dom-html-empty-clear"
            : "dom-html-write",
          node,
          node.right,
        )
      } else if (member === "srcdoc" || member === "srcDoc") {
        record("srcdoc", node, node.right)
      } else if (member === "src" && receiver) {
        const receiverName = ts.isIdentifier(receiver) ? receiver.text : ""
        if (scriptBindings.has(receiverName) || /script/i.test(receiverName)) {
          record("script-src-assignment", node, node.right)
        }
      }
    }
    // Calls
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (isRemoteOrComputedSpecifier(node.arguments[0])) {
          record("remote-import", node, node.arguments[0])
        }
      } else if (ts.isIdentifier(callee) && callee.text === "importScripts") {
        record("import-scripts", node)
      } else if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text
        const receiverText = unwrap(callee.expression).getText()
        if (method === "insertAdjacentHTML") {
          record("insertAdjacentHTML", node, node.arguments[1])
        } else if (
          (method === "write" || method === "writeln") &&
          /(^|\.)document$/.test(receiverText)
        ) {
          record("document-write", node, node.arguments[0])
        } else if (method === "createContextualFragment") {
          record("contextual-fragment", node, node.arguments[0])
        } else if (method === "setHTMLUnsafe" || method === "parseHTMLUnsafe") {
          record("set-html-unsafe", node, node.arguments[0])
        } else if (method === "importScripts") {
          record("import-scripts", node)
        } else if (
          method === "setAttribute" &&
          /^srcdoc$/i.test(stringValue(node.arguments[0]) ?? "")
        ) {
          record("srcdoc", node, node.arguments[1])
        }
      }
      if (isScriptCreateElement(node)) {
        record("dynamic-script", node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return sites
}

function scanHtml(fileLabel: string, sourceText: string): SinkSite[] {
  const sites: SinkSite[] = []
  const lineOf = (index: number) =>
    sourceText.slice(0, index).split("\n").length
  const tagPattern = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g
  for (const match of sourceText.matchAll(tagPattern)) {
    const [, tagName, attributes] = match
    const index = match.index ?? 0
    for (const attr of attributes.matchAll(/\s(on[a-z]+)\s*=/gi)) {
      sites.push({
        sinkClass: "html-inline-handler",
        file: fileLabel,
        symbol: `<${tagName.toLowerCase()}>`,
        line: lineOf(index),
        valueText: attr[1],
      })
    }
    if (/\ssrcdoc\s*=/i.test(attributes)) {
      sites.push({
        sinkClass: "srcdoc",
        file: fileLabel,
        symbol: `<${tagName.toLowerCase()}>`,
        line: lineOf(index),
        valueText: attributes,
      })
    }
    if (tagName.toLowerCase() === "script") {
      const src = /\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]
      if (src && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
        sites.push({
          sinkClass: "html-remote-script",
          file: fileLabel,
          symbol: "<script>",
          line: lineOf(index),
          valueText: src,
        })
      }
      if (!src) {
        const closeIndex = sourceText.indexOf("</script>", index)
        const body = sourceText.slice(index + match[0].length, closeIndex)
        if (body.trim().length > 0) {
          sites.push({
            sinkClass: "html-inline-script",
            file: fileLabel,
            symbol: "<script>",
            line: lineOf(index),
            valueText: body.trim().slice(0, 80),
          })
        }
      }
    }
  }
  return sites
}

export function scanTree(repoRoot: string, rootDir: string): SinkSite[] {
  return walkScannedFiles(rootDir).flatMap((file) =>
    scanSource(relative(repoRoot, file), readFileSync(file, "utf-8")),
  )
}
