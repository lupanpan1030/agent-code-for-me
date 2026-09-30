/**
 * Canonical renderer raw-sink scanner used by the renderer source-guard owner
 * `tests/renderer-html-sinks.test.ts` (openspec change
 * `add-renderer-untrusted-content-hardening`, design D1, tasks 1.1/1.2).
 *
 * Every JavaScript/TypeScript file is parsed with the TypeScript compiler API
 * so comments and string contents are never mistaken for sinks; HTML files
 * are scanned for inline handlers, `srcdoc`, and inline/remote scripts. Each
 * site is reported with its construct, file, nearest named enclosing symbol,
 * line and value text, so the guard can key an exact inventory by construct
 * and enclosing owner instead of a whole-file exemption.
 *
 * Not a test file (no `.test.` infix): Bun only loads it through importers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import ts from "typescript"

export type RendererSinkConstruct =
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
  | "html-inline-handler"
  | "html-srcdoc"
  | "html-remote-script"
  | "html-inline-script"

export interface RendererSinkSite {
  construct: RendererSinkConstruct
  file: string
  symbol: string
  line: number
  valueText: string
}

export const RENDERER_SCANNED_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|html)$/

export function listRendererScannedFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...listRendererScannedFiles(fullPath))
    } else if (RENDERER_SCANNED_EXTENSIONS.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (/\.(?:js|mjs|cjs)$/.test(fileName)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function unwrapExpression(node: ts.Expression): ts.Expression {
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

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

function memberName(name: ts.PropertyName | ts.MemberName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  return literalText(name)
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
    current = current.parent
  }
  return "<module>"
}

function isScriptElementFactory(node: ts.Expression): boolean {
  const call = unwrapExpression(node)
  if (!ts.isCallExpression(call)) return false
  const callee = call.expression
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null
  if (name !== "createElement" && name !== "createElementNS") return false
  const tag = literalText(call.arguments[name === "createElementNS" ? 1 : 0])
  return tag?.toLowerCase() === "script"
}

function isRemoteOrComputedSpecifier(argument: ts.Expression | undefined) {
  const literal = literalText(argument)
  return literal === null || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(literal)
}

const HTML_MEMBERS = new Set(["innerHTML", "outerHTML"])
const SRCDOC_MEMBERS = new Set(["srcdoc", "srcDoc"])

export function scanRendererSource(
  file: string,
  sourceText: string,
): RendererSinkSite[] {
  if (file.endsWith(".html")) return scanRendererHtml(file, sourceText)
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  )
  const sites: RendererSinkSite[] = []
  const scriptBindings = new Set<string>()
  const record = (
    construct: RendererSinkConstruct,
    node: ts.Node,
    value?: ts.Node,
  ) => {
    sites.push({
      construct,
      file,
      symbol: enclosingSymbol(node),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      valueText: (value ?? node).getText(),
    })
  }
  const htmlMemberWrite = (
    node: ts.Node,
    value: ts.Expression,
    isPlainAssignment: boolean,
  ) => {
    const literal = literalText(unwrapExpression(value))
    record(
      literal === "" && isPlainAssignment
        ? "dom-html-empty-clear"
        : "dom-html-write",
      node,
      value,
    )
  }

  const collectScriptBindings = (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name)
    ) {
      const typeText = node.type?.getText() ?? ""
      if (
        /HTMLScriptElement/.test(typeText) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          isScriptElementFactory(node.initializer))
      ) {
        scriptBindings.add(node.name.text)
      }
    }
    ts.forEachChild(node, collectScriptBindings)
  }
  collectScriptBindings(sourceFile)

  const isScriptReceiver = (receiver: ts.Expression) => {
    const target = unwrapExpression(receiver)
    if (isScriptElementFactory(target)) return true
    const name = ts.isIdentifier(target)
      ? target.text
      : ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ""
    return scriptBindings.has(name) || /script/i.test(name)
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText()
      if (name === "dangerouslySetInnerHTML") {
        record("react-dangerouslySetInnerHTML", node, node.initializer)
      } else if (name.toLowerCase() === "srcdoc") {
        record("srcdoc", node, node.initializer)
      } else if (name === "unsafeCSS") {
        record("dependency-unsafeCSS", node, node.initializer)
      } else if (name === "prerenderedHTML") {
        record("dependency-prerenderedHTML", node, node.initializer)
      }
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText().toLowerCase() === "script"
    ) {
      record("dynamic-script", node)
    }
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      const name = memberName(node.name)
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.name
      if (name === "dangerouslySetInnerHTML") {
        record("react-dangerouslySetInnerHTML", node, value)
      } else if (name && HTML_MEMBERS.has(name)) {
        htmlMemberWrite(node, value, true)
      } else if (name && SRCDOC_MEMBERS.has(name)) {
        record("srcdoc", node, value)
      } else if (name === "unsafeCSS") {
        record("dependency-unsafeCSS", node, value)
      } else if (name === "prerenderedHTML") {
        record("dependency-prerenderedHTML", node, value)
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = unwrapExpression(node.left)
      let member: string | null = null
      let receiver: ts.Expression | null = null
      if (ts.isPropertyAccessExpression(target)) {
        member = target.name.text
        receiver = target.expression
      } else if (ts.isElementAccessExpression(target)) {
        member = literalText(target.argumentExpression)
        receiver = target.expression
      }
      if (member && HTML_MEMBERS.has(member)) {
        htmlMemberWrite(
          node,
          node.right,
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken,
        )
      } else if (member && SRCDOC_MEMBERS.has(member)) {
        record("srcdoc", node, node.right)
      } else if (member === "src" && receiver && isScriptReceiver(receiver)) {
        record("script-src-assignment", node, node.right)
      }
    }
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
        const receiverText = unwrapExpression(callee.expression).getText()
        const firstArgument = literalText(node.arguments[0])
        if (method === "insertAdjacentHTML") {
          record("insertAdjacentHTML", node, node.arguments[1])
        } else if (
          (method === "write" || method === "writeln") &&
          /(?:^|\.)document$/.test(receiverText)
        ) {
          record("document-write", node, node.arguments[0])
        } else if (method === "createContextualFragment") {
          record("contextual-fragment", node, node.arguments[0])
        } else if (method === "setHTMLUnsafe" || method === "parseHTMLUnsafe") {
          record("set-html-unsafe", node, node.arguments[0])
        } else if (method === "importScripts") {
          record("import-scripts", node)
        } else if (method === "setAttribute" && firstArgument !== null) {
          if (/^srcdoc$/i.test(firstArgument)) {
            record("srcdoc", node, node.arguments[1])
          } else if (
            /^src$/i.test(firstArgument) &&
            isScriptReceiver(callee.expression)
          ) {
            record("script-src-assignment", node, node.arguments[1])
          }
        } else if (
          method === "set" &&
          receiverText === "Reflect" &&
          HTML_MEMBERS.has(literalText(node.arguments[1]) ?? "")
        ) {
          record("dom-html-write", node, node.arguments[2])
        }
      }
      if (isScriptElementFactory(node)) {
        record("dynamic-script", node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return sites
}

function scanRendererHtml(
  file: string,
  sourceText: string,
): RendererSinkSite[] {
  const sites: RendererSinkSite[] = []
  const lineOf = (index: number) =>
    sourceText.slice(0, index).split("\n").length
  for (const match of sourceText.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const [, tagName, attributes] = match
    const index = match.index ?? 0
    const tag = tagName.toLowerCase()
    const site = (construct: RendererSinkConstruct, valueText: string) =>
      sites.push({
        construct,
        file,
        symbol: `<${tag}>`,
        line: lineOf(index),
        valueText,
      })
    for (const handler of attributes.matchAll(/\s(on[a-z]+)\s*=/gi)) {
      site("html-inline-handler", handler[1])
    }
    if (/\ssrcdoc\s*=/i.test(attributes)) site("html-srcdoc", attributes)
    if (tag === "script") {
      const src = /\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]
      if (src && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
        site("html-remote-script", src)
      }
      if (!src) {
        const closing = sourceText.indexOf("</script>", index)
        const body = sourceText.slice(index + match[0].length, closing)
        if (body.trim()) site("html-inline-script", body.trim().slice(0, 80))
      }
    }
  }
  return sites
}

export function scanRendererTree(
  repoRoot: string,
  rendererRoot: string,
): RendererSinkSite[] {
  return listRendererScannedFiles(rendererRoot).flatMap((file) =>
    scanRendererSource(
      relative(repoRoot, file).split(sep).join("/"),
      readFileSync(file, "utf-8"),
    ),
  )
}
