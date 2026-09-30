import { toast } from "sonner"
import { en, zhCN, type TranslationKey } from "../../../lib/i18n/dictionaries"
import type { ChatImageAttachmentSource } from "../../../../shared/chat-attachments"
import type { MentionsEditorPasteResult } from "../mentions/agents-mentions-editor"

// Threshold for auto-converting large pasted text to a file (5KB)
// Text larger than this will be saved as a file attachment instead of pasted inline
export const LARGE_PASTE_THRESHOLD = 5_000

// Maximum characters allowed for paste (10KB of text)
// ContentEditable elements become extremely slow with large text content,
// causing browser/system freeze. 50KB still causes noticeable lag on some systems.
// For larger content, users should attach it as a file instead.
const MAX_PASTE_LENGTH = 10_000

// Threshold for showing "very large" warning (1MB+)
const VERY_LARGE_THRESHOLD = 1_000_000

function t(key: TranslationKey, values?: Record<string, string | number>) {
  const useZh =
    typeof navigator !== "undefined" &&
    (navigator.language || navigator.languages?.[0] || "").toLowerCase().startsWith("zh")
  const template = (useZh ? zhCN[key] : en[key]) || en[key] || key

  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values?.[name]
    return value === undefined ? match : String(value)
  })
}

// Callback type for adding large pasted text as a file
export type AddPastedTextFn = (text: string) => Promise<void>

/**
 * Bounds pasted text to the editor's remaining capacity so a large paste
 * cannot freeze the contentEditable editor, with a warning toast when the
 * text is truncated. Returns the text to insert, or null when nothing fits.
 *
 * @param text - The pasted plain text
 * @param existingLength - Current editor text length
 */
function boundPastedText(text: string, existingLength: number): string | null {
  const availableSpace = Math.max(0, MAX_PASTE_LENGTH - existingLength)
  const effectiveLimit = Math.min(text.length, availableSpace)

  if (text.length <= effectiveLimit) return text

  if (availableSpace === 0) {
    // No space left at all
    toast.warning(t("agent.paste.inputFull"), {
      description: t("agent.paste.inputFullDescription"),
    })
    return null
  }

  const originalKB = Math.round(text.length / 1024)
  if (text.length > VERY_LARGE_THRESHOLD) {
    const originalMB = (text.length / 1_000_000).toFixed(1)
    toast.warning(t("agent.paste.textTruncated"), {
      description: t("agent.paste.originalTextMb", { size: originalMB }),
    })
  } else {
    const truncatedKB = Math.round(effectiveLimit / 1024)
    toast.warning(t("agent.paste.textTruncatedToKb", { size: truncatedKB }), {
      description: t("agent.paste.originalTextKb", { size: originalKB }),
    })
  }
  return text.slice(0, effectiveLimit)
}

/**
 * Typed paste delegate for the mentions editor (openspec change
 * `add-renderer-untrusted-content-hardening`, design D4).
 * Images go to handleAddAttachments; text larger than LARGE_PASTE_THRESHOLD
 * is saved as a file attachment; other plain text is bounded and returned for
 * the editor to insert through its safe builder. Clipboard data without
 * text/plain (HTML-only) is rejected. The editor has already prevented the
 * browser default; this delegate never inserts content itself.
 *
 * @param e - The clipboard event
 * @param handleAddAttachments - Callback to handle image attachments
 * @param addPastedText - Optional callback to save large text as a file
 */
export function handlePasteEvent(
  e: React.ClipboardEvent,
  handleAddAttachments: (
    files: File[],
    source?: ChatImageAttachmentSource,
  ) => void,
  addPastedText?: AddPastedTextFn,
): MentionsEditorPasteResult {
  // Defense in depth: never return control to a browser rich-content default.
  e.preventDefault()

  const files = Array.from(e.clipboardData.items)
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean) as File[]

  if (files.length > 0) {
    handleAddAttachments(files, "clipboard")
    return { kind: "consumed" }
  }

  // Plain text only: HTML-only clipboard data is never inserted.
  const text = e.clipboardData.getData("text/plain")
  if (!text) return { kind: "consumed" }

  // Large text: save as file attachment instead of pasting inline
  if (text.length > LARGE_PASTE_THRESHOLD && addPastedText) {
    void addPastedText(text)
    return { kind: "consumed" }
  }

  // Account for existing content so the total size stays within the limit
  const target = e.currentTarget as HTMLElement
  const editableElement = target.closest('[contenteditable="true"]') || target
  const bounded = boundPastedText(
    text,
    editableElement?.textContent?.length || 0,
  )
  return bounded === null
    ? { kind: "consumed" }
    : { kind: "insertText", text: bounded }
}
