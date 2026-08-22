export function createBatchDispatcher(resend) {
  return {
    supportsAttachments: false,
    async dispatch(messages) {
      const results = []
      for (let offset = 0; offset < messages.length; offset += 100) {
        const chunk = messages.slice(offset, offset + 100)
        try {
          const response = await resend.batch.send(chunk.map((message) => message.payload), {
            idempotencyKey: `outreach-batch:${chunk.map((message) => message.recipientId).join('-')}`,
            batchValidation: 'permissive',
          })
          if (response.error) {
            results.push(...chunk.map((message) => ({ recipientId: message.recipientId, error: response.error.message ?? 'Send failed' })))
          } else {
            const ids = response.data?.data ?? []
            results.push(...chunk.map((message, index) => ({ recipientId: message.recipientId, providerMessageId: ids[index]?.id ?? null })))
          }
        } catch (err) {
          results.push(...chunk.map((message) => ({ recipientId: message.recipientId, error: err instanceof Error ? err.message : 'Send failed' })))
        }
      }
      return results
    },
  }
}
