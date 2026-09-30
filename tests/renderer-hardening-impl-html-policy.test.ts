/**
 * Implementer tests for the reviewed renderer HTML owner
 * `src/renderer/lib/security/renderer-html-policy.ts` (openspec change
 * `add-renderer-untrusted-content-hardening`, design D1/D2/D3, tasks
 * 2.1/2.2/2.4/2.5), plus a self-test of the shared rendered-DOM oracle helper
 * that implements the owner's profiles.
 */
import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { harden } from "rehype-harden"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { createHighlighter } from "shiki"
import {
  REVIEWED_MARKDOWN_HARDEN_OPTIONS,
  REVIEWED_MARKDOWN_REHYPE_PLUGINS,
  REVIEWED_MARKDOWN_SANITIZE_SCHEMA,
  type ReviewedRendererHtml,
  reviewedEscapedText,
  reviewedInnerHtml,
  reviewedPlainCodeToHtml,
  reviewShikiCodeToHtmlOutput,
} from "../src/renderer/lib/security/renderer-html-policy"
import {
  findRendererMarkupViolations,
  type MarkupOracleProfile,
} from "./helpers/renderer-executable-markup-oracle"

const testWindow = new Window({ url: "http://localhost/" })

function parse(html: string) {
  const host = testWindow.document.createElement("div")
  host.innerHTML = html
  return host
}

function markupOf(html: ReviewedRendererHtml): string {
  return reviewedInnerHtml(html).__html
}

const HOSTILE_SOURCE =
  "const x = \"</code></pre><img src=x onerror=alert(1)>\" & 'q' > b"

describe("reviewed output contract", () => {
  test("a forged value never reaches a raw sink", () => {
    const forged =
      "<img src=x onerror=alert(1)>" as unknown as ReviewedRendererHtml
    expect(reviewedInnerHtml(forged)).toEqual({ __html: "" })
    const forgedObject = {} as ReviewedRendererHtml
    expect(reviewedInnerHtml(forgedObject)).toEqual({ __html: "" })
  })

  test("reviewedEscapedText renders untrusted text as inert text only", () => {
    const html = markupOf(reviewedEscapedText(HOSTILE_SOURCE))
    expect(html).toBe(
      "const x = &quot;&lt;/code&gt;&lt;/pre&gt;&lt;img src=x onerror=alert(1)&gt;&quot; &amp; &#39;q&#39; &gt; b",
    )
    const host = parse(html)
    expect(host.children.length).toBe(0)
    expect(host.textContent).toBe(HOSTILE_SOURCE)
  })

  test("the Q9 shim codeToHtml adapter escapes through the owner", () => {
    const html = reviewedPlainCodeToHtml("<b>x</b> & y")
    expect(html).toBe("<pre><code>&lt;b&gt;x&lt;/b&gt; &amp; y</code></pre>")
  })
})

describe("Shiki output adapter (design D3)", () => {
  test("real Shiki output is accepted byte-for-byte for every app theme family and escapes hostile source", async () => {
    const highlighter = await createHighlighter({
      themes: ["github-dark", "github-light", "vesper", "min-light"],
      langs: ["typescript", "json"],
    })
    const sources = [
      HOSTILE_SOURCE,
      "line one\n\n\tline three // <b>not bold</b>",
      '{"a": "<script>alert(1)</script>", "b": [1, 2]}',
      "",
    ]
    for (const theme of [
      "github-dark",
      "github-light",
      "vesper",
      "min-light",
    ]) {
      for (const [index, source] of sources.entries()) {
        const generated = highlighter.codeToHtml(source, {
          lang: index === 2 ? "json" : "typescript",
          theme,
        })
        const review = reviewShikiCodeToHtmlOutput(generated, source)
        expect(review.accepted).toBe(true)
        const inner = generated.slice(
          generated.indexOf("<code>") + "<code>".length,
          generated.length - "</code></pre>".length,
        )
        expect(markupOf(review.html)).toBe(inner)
        const host = parse(markupOf(review.html))
        expect(host.textContent).toBe(source)
        expect(host.querySelectorAll("img, b, script").length).toBe(0)
        expect(
          findRendererMarkupViolations(host as never, {
            kind: "highlightedCode",
          }),
        ).toEqual([])
      }
    }
  })

  const rejected: Array<[string, string, string]> = [
    [
      "missing <code> wrapper",
      '<pre class="shiki"><span>no code</span></pre>',
      "missing-wrapper",
    ],
    ["no wrapper at all", "<span>x</span>", "missing-wrapper"],
    [
      "dual top-level pre/code",
      "<pre><code><span>a</span></code></pre><pre><code><span>b</span></code></pre>",
      "inner-shape",
    ],
    [
      "trailing output after the wrapper",
      "<pre><code><span>a</span></code></pre><span>tail</span>",
      "trailing-output",
    ],
    [
      "leading output before the wrapper",
      "<b>x</b><pre><code><span>a</span></code></pre>",
      "missing-wrapper",
    ],
    [
      "nested code element",
      "<pre><code><code>a</code></code></pre>",
      "inner-shape",
    ],
    [
      "executable element inside code",
      "<pre><code><img src=x onerror=alert(1)></code></pre>",
      "inner-shape",
    ],
    ["unbalanced span", "<pre><code><span>a</code></pre>", "inner-shape"],
    ["stray closing span", "<pre><code>a</span></code></pre>", "inner-shape"],
    ["comment", "<pre><code><!-- x --></code></pre>", "inner-shape"],
    ["uppercase tag", "<pre><code><SPAN>a</SPAN></code></pre>", "inner-shape"],
    [
      "unquoted attribute",
      "<pre><code><span class=line>a</span></code></pre>",
      "inner-shape",
    ],
    [
      "excessive nesting",
      `<pre><code>${"<span>".repeat(17)}a${"</span>".repeat(17)}</code></pre>`,
      "inner-shape",
    ],
  ]

  for (const [label, generated, reason] of rejected) {
    test(`rejects ${label} and degrades to escaped source text`, () => {
      const review = reviewShikiCodeToHtmlOutput(generated, HOSTILE_SOURCE)
      expect(review.accepted).toBe(false)
      if (!review.accepted) expect(review.reason).toBe(reason)
      expect(markupOf(review.html)).toBe(
        markupOf(reviewedEscapedText(HOSTILE_SOURCE)),
      )
      const host = parse(markupOf(review.html))
      expect(host.children.length).toBe(0)
      expect(host.textContent).toBe(HOSTILE_SOURCE)
    })
  }

  test("re-serializes span attributes under the reviewed class/style value profile", () => {
    const generated =
      '<pre class="shiki"><code><span class="line fixed inset-0" onclick="alert(1)" id="x" data-a="1"><span style="color:#F97583;position:fixed;background:url(https://evil.example/b);font-style:italic;behavior:url(x.htc)">a</span><span style="color:red">b</span><span class="evil">c</span></span></code></pre>'
    const review = reviewShikiCodeToHtmlOutput(generated, "abc")
    expect(review.accepted).toBe(true)
    expect(markupOf(review.html)).toBe(
      '<span class="line"><span style="color:#F97583;font-style:italic">a</span><span>b</span><span>c</span></span>',
    )
    expect(
      findRendererMarkupViolations(parse(markupOf(review.html)) as never, {
        kind: "highlightedCode",
      }),
    ).toEqual([])
  })
})

describe("explicit reviewed markdown rehype chain (design D2)", () => {
  test("the chain is exactly [rehypeRaw, [rehypeSanitize, schema], [harden, options]]", () => {
    const chain = REVIEWED_MARKDOWN_REHYPE_PLUGINS as unknown as unknown[]
    expect(chain).toHaveLength(3)
    expect(chain[0]).toBe(rehypeRaw)
    expect(chain[1]).toEqual([
      rehypeSanitize,
      REVIEWED_MARKDOWN_SANITIZE_SCHEMA,
    ])
    expect((chain[1] as unknown[])[0]).toBe(rehypeSanitize)
    expect((chain[1] as unknown[])[1]).toBe(REVIEWED_MARKDOWN_SANITIZE_SCHEMA)
    expect((chain[2] as unknown[])[0]).toBe(harden)
    expect((chain[2] as unknown[])[1]).toBe(REVIEWED_MARKDOWN_HARDEN_OPTIONS)
  })

  test("the schema derives from defaultSchema and only narrows it", () => {
    const schema = REVIEWED_MARKDOWN_SANITIZE_SCHEMA
    expect(schema.tagNames).toEqual(defaultSchema.tagNames)
    expect(schema.strip).toEqual(defaultSchema.strip)
    expect(schema.ancestors).toEqual(defaultSchema.ancestors)
    expect(schema.clobber).toEqual(defaultSchema.clobber)
    expect(schema.clobberPrefix).toBe(defaultSchema.clobberPrefix)
    expect(schema.allowComments).toBeFalsy()
    expect(schema.protocols).toEqual({
      href: ["http", "https", "mailto"],
      src: ["http", "https"],
      cite: ["http", "https"],
    })
    const names = (tag: string) =>
      (schema.attributes?.[tag] ?? []).map((definition) =>
        typeof definition === "string" ? definition : definition[0],
      )
    const defaultNames = (tag: string) =>
      (defaultSchema.attributes?.[tag] ?? []).map((definition) =>
        typeof definition === "string" ? definition : definition[0],
      )
    for (const tag of Object.keys(schema.attributes ?? {})) {
      // Narrowing only: no attribute outside defaultSchema is admitted.
      expect(
        names(tag).filter((name) => !defaultNames(tag).includes(name)),
      ).toEqual([])
    }
    expect(names("*")).not.toContain("action")
    expect(names("source")).not.toContain("srcSet")
    expect(names("img")).not.toContain("longDesc")
  })

  test("deriving the schema does not mutate or freeze the library defaultSchema", () => {
    expect(defaultSchema.protocols?.href).toContain("irc")
    expect(Object.isFrozen(defaultSchema.attributes)).toBe(false)
    expect(Object.isFrozen(defaultSchema.tagNames)).toBe(false)
    expect(Object.isFrozen(REVIEWED_MARKDOWN_SANITIZE_SCHEMA)).toBe(true)
  })

  test("harden admits no custom protocol and no data images", () => {
    expect(REVIEWED_MARKDOWN_HARDEN_OPTIONS.allowedProtocols).toEqual([])
    expect(REVIEWED_MARKDOWN_HARDEN_OPTIONS.allowDataImages).toBe(false)
    expect(Object.isFrozen(REVIEWED_MARKDOWN_HARDEN_OPTIONS)).toBe(true)
  })
})

describe("shared rendered-DOM oracle helper distinguishes every rule (self-test)", () => {
  const markdown: MarkupOracleProfile = { kind: "markdown" }
  const mustFail: Array<[string, string]> = [
    ["script", "<script>1</script>"],
    ["iframe", '<iframe src="https://example.com"></iframe>'],
    ["object", "<object></object>"],
    ["embed", "<embed>"],
    ["base", '<base href="https://evil.example/">'],
    ["meta", "<meta http-equiv=refresh>"],
    ["link", '<link rel="stylesheet" href="https://e/x.css">'],
    ["foreignObject", "<svg><foreignObject></foreignObject></svg>"],
    ["animate", '<svg><animate attributeName="x"></animate></svg>'],
    ["set", '<svg><set attributeName="x"></set></svg>'],
    ["maction", "<math><maction>m</maction></math>"],
    ["style element", "<style>a{}</style>"],
    ["on* attribute", '<span OnClick="1">x</span>'],
    ["srcdoc", '<div srcdoc="<b>x</b>"></div>'],
    ["javascript href", '<a href="jav&#x09;ascript:1">x</a>'],
    ["data src", '<img src="data:image/png;base64,AAAA">'],
    ["file href", '<a href="file:///etc/passwd">x</a>'],
    ["blob src", '<img src="blob:https://e/1">'],
    ["custom scheme", '<a href="locus://x">x</a>'],
    ["mailto media", '<img src="mailto:a@b.c">'],
    ["relative href", '<a href="./x">x</a>'],
    ["rooted href", '<a href="/etc/passwd">x</a>'],
    ["fragment href", '<a href="#top">x</a>'],
    ["action", '<div action="javascript:1">x</div>'],
    ["overlay css", '<div style="position:fixed;inset:0">o</div>'],
    ["remote css", '<div style="background:url(https://e/b)">o</div>'],
  ]

  test("rejects each forbidden construct and accepts reviewed formatting", () => {
    const missed = mustFail
      .filter(
        ([, html]) =>
          findRendererMarkupViolations(parse(html) as never, markdown)
            .length === 0,
      )
      .map(([name]) => name)
    expect(missed).toEqual([])
    const safe = parse(
      '<p><strong>b</strong> <em>e</em> <a href="https://example.com/x">l</a> <a href="mailto:a@b.c">m</a> <img src="https://example.com/i.png"></p><table><tr><td>1</td></tr></table><pre><code>&lt;b&gt;</code></pre>',
    )
    expect(findRendererMarkupViolations(safe as never, markdown)).toEqual([])
  })

  test("the highlighted-code profile admits no URL and only reviewed span styles", () => {
    const profile: MarkupOracleProfile = { kind: "highlightedCode" }
    expect(
      findRendererMarkupViolations(
        parse('<span style="color:#fff;font-style:italic">a</span>') as never,
        profile,
      ),
    ).toEqual([])
    expect(
      findRendererMarkupViolations(
        parse('<span style="display:none">a</span>') as never,
        profile,
      ).length,
    ).toBe(1)
    expect(
      findRendererMarkupViolations(
        parse('<a href="https://example.com">a</a>') as never,
        profile,
      ).length,
    ).toBe(1)
  })

  test("the diff profile requires exactly one constant style and separator-only icon fragments", () => {
    const profile: MarkupOracleProfile = {
      kind: "diff",
      expectedUnsafeCssTextContent: "a{}",
    }
    const ok = parse(
      '<style data-unsafe-css="">a{}</style><div data-separator=""><svg><use href="#diffs-icon-expand"></use></svg></div>',
    )
    expect(findRendererMarkupViolations(ok as never, profile)).toEqual([])
    const drift = parse('<style data-unsafe-css="">a{};</style>')
    expect(
      findRendererMarkupViolations(drift as never, profile).map((v) => v.rule),
    ).toEqual(["diff-unsafe-css-drift"])
    const missing = parse("<div></div>")
    expect(
      findRendererMarkupViolations(missing as never, profile).map(
        (v) => v.rule,
      ),
    ).toEqual(["diff-unsafe-css-count"])
    const outside = parse(
      '<style data-unsafe-css="">a{}</style><svg><use href="#diffs-icon-expand"></use></svg>',
    )
    expect(
      findRendererMarkupViolations(outside as never, profile).map(
        (v) => v.rule,
      ),
    ).toEqual(["diff-use-href"])
  })
})
