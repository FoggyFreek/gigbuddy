// Gig-task domain logic. Route handlers stay thin and delegate here.
import { listGigTasks } from '../repositories/taskRepository.js'

export async function listTasks(db, tenantId) {
  return listGigTasks(db, tenantId)
}
