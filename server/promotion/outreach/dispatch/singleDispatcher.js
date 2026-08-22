export function createSingleDispatcher(resend) {
  return {
    supportsAttachments: true,
    async dispatch(messages) {
      const results = []
      for (const message of messages) {
        try {
          const response = await resend.emails.send(message.payload, { idempotencyKey: message.idempotencyKey })
          if (response.error) results.push({ recipientId: message.recipientId, error: response.error.message ?? 'Send failed' })
          else results.push({ recipientId: message.recipientId, providerMessageId: response.data?.id ?? null })
        } catch (err) {
          results.push({ recipientId: message.recipientId, error: err instanceof Error ? err.message : 'Send failed' })
        }
      }
      return results
    },
  }
}
