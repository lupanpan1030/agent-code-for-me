const chatViewInstanceKeys = new WeakMap<object, number>()
let nextChatViewInstanceKey = 1

/**
 * React's AI SDK hook does not resubscribe when a same-id Chat object is
 * replaced. Key the view by object identity so binding-driven transport
 * recreation remounts the hook and subscribes to the new instance.
 */
export function getChatViewInstanceKey(chat: object): string {
  let key = chatViewInstanceKeys.get(chat)
  if (key === undefined) {
    key = nextChatViewInstanceKey
    nextChatViewInstanceKey += 1
    chatViewInstanceKeys.set(chat, key)
  }
  return `chat-instance-${key}`
}
