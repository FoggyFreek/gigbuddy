import { clearPendingChange } from './subscriptionRepository.js'
import {
  clearModulePendingChange,
  deleteModule,
  listModules,
} from './subscriptionModuleRepository.js'

export async function rollbackPendingModuleChange(db, subscriptionId) {
  const modules = await listModules(db, subscriptionId)
  for (const module of modules) {
    if (module.status === 'pending') await deleteModule(db, module.id)
    else if (module.pending_change_kind === 'upgrade') {
      await clearModulePendingChange(db, module.id)
    }
  }
  await clearPendingChange(db, subscriptionId)
}
