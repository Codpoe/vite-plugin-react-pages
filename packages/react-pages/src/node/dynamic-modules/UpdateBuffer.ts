import { EventEmitter } from 'events'
import { debounce } from 'mini-debounce'

/**
 * Types of page data updates.
 *
 * add:
 *  A new page is added.
 *  The page list module will be updated.
 * update:
 *  A page is updated.
 *  The page list module will be updated if it is static data change
 *  The page data module will be updated if it is runtime data change
 * delete:
 *  A page is deleted.
 *  The page list module will be updated.
 *  Buffered update of the deleted page will be cancled.
 */
type Update =
  | {
      type: 'add' | 'delete'
      pageId: string
    }
  | {
      type: 'update'
      pageId: string
      dataType: 'runtime' | 'static'
    }

export type ScheduleUpdate = (update: Update) => void

/**
 * Buffer page data updates.
 * Can flush a batch of updates together
 * and cancle unnecessary updates
 */
export class UpdateBuffer extends EventEmitter {
  /**
   * which pages should be updated
   */
  private pageUpdateBuffer = new Set<string>()

  /**
   * whether the page list should be updated
   */
  private pageListUpdateBuffer = false

  private scheduleFlush: () => void

  constructor() {
    super()
    this.scheduleFlush = debounce(() => {
      if (this.pageUpdateBuffer.size > 0) {
        const updates = [...this.pageUpdateBuffer.values()]
        this.emit('page', updates)
        this.pageUpdateBuffer.clear()
      }

      if (this.pageListUpdateBuffer) {
        // if this.pageUpdateBuffer.size >= 0
        // the page update will automatically update the page list
        // (because the whole import chain will update)
        // so we don't need to trigger page list update in that case
        if (this.pageUpdateBuffer.size === 0) this.emit('page-list')
        this.pageListUpdateBuffer = false
      }
    }, 100)
  }

  scheduleUpdate(update: Update) {
    switch (update.type) {
      case 'add':
        this.pageListUpdateBuffer = true
        break
      case 'update':
        if (update.dataType === 'static') this.pageListUpdateBuffer = true
        else this.pageUpdateBuffer.add(update.pageId)
        break
      case 'delete':
        this.pageListUpdateBuffer = true
        this.pageUpdateBuffer.delete(update.pageId)
        break
      default:
        throw new Error(`invalid update type ${JSON.stringify(update)}`)
    }
    this.scheduleFlush()
  }

  async batchUpdate(exec: (scheduleUpdate: ScheduleUpdate) => Promise<void>) {
    let updates: Update[] | null = []
    const _this = this

    try {
      await exec(scheduleUpdate)
    } finally {
      updates.forEach((update) => {
        _this.scheduleUpdate(update)
      })
      updates = null
      this.scheduleFlush()
    }

    function scheduleUpdate(update: Update) {
      if (!updates) {
        // the batch lifetime has already expired
        // add it to buffer directly
        _this.scheduleUpdate(update)
        return
      }
      // store it, will flust these updates together later
      updates.push(update)
    }
  }
}