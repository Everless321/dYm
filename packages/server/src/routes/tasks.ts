import type { FastifyInstance } from 'fastify'
import {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskUsers,
  deleteTask,
  type DbTask
} from '../database/index.js'
import { scheduleTask, unscheduleTask } from '../services/scheduler.js'
import type { CreateTaskInput, UpdateTaskInput } from '@dym/shared'

export function registerTaskRoutes(server: FastifyInstance): void {
  server.get('/api/tasks', async () => {
    try {
      const tasks = getAllTasks()
      return { success: true, data: tasks }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    try {
      const task = getTaskById(parseInt(request.params.id))
      if (!task) throw new Error('任务不存在')
      return { success: true, data: task }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Body: CreateTaskInput }>('/api/tasks', async (request) => {
    try {
      const input = request.body as CreateTaskInput
      const task = createTask(input)
      return { success: true, data: task }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.put<{ Params: { id: string }; Body: UpdateTaskInput }>('/api/tasks/:id', async (request) => {
    try {
      const id = parseInt(request.params.id)
      const input = request.body as UpdateTaskInput

      const dbInput: Partial<Omit<DbTask, 'id' | 'created_at'>> = {}
      if (input.name !== undefined) dbInput.name = input.name
      if (input.status !== undefined) dbInput.status = input.status as DbTask['status']
      if (input.concurrency !== undefined) dbInput.concurrency = input.concurrency
      if (input.auto_sync !== undefined) dbInput.auto_sync = input.auto_sync ? 1 : 0
      if (input.sync_cron !== undefined) dbInput.sync_cron = input.sync_cron

      const task = updateTask(id, dbInput)

      if (task) {
        if (task.auto_sync && task.sync_cron) {
          scheduleTask(task)
        } else {
          unscheduleTask(id)
        }
      }

      return { success: true, data: task }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.put<{ Params: { id: string }; Body: { userIds: number[] } }>(
    '/api/tasks/:id/users',
    async (request) => {
      try {
        const taskId = parseInt(request.params.id)
        const { userIds } = request.body as { userIds: number[] }
        const task = updateTaskUsers(taskId, userIds)
        return { success: true, data: task }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  server.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    try {
      const id = parseInt(request.params.id)
      unscheduleTask(id)
      deleteTask(id)
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
