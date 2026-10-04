// Revisão (QA #3): fila de saída de e-mails e texto do log anexado.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { RunRecord } from '@shared/types'
import { Outbox } from '../src/main/mail/outbox'
import { runLogText } from '../src/main/mail/compose'
import { renderRunEmail } from '../src/main/mail/template'
import { tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-review-mail-'))
})
afterEach(() => cleanup())

const mail = { to: ['a@b.com'], subject: 's', html: 'h', text: 't' }

describe('Outbox: falha ao registrar no histórico não vira falha de envio', () => {
  it('e-mail enviado com o histórico indisponível: não é dado como "não enviado" nem rejeita', async () => {
    // Item criado há quase 24 h: se o erro do onSent fosse tratado como falha de envio, expiraria.
    let now = new Date('2026-10-04T10:00:00Z')
    let sends = 0
    const expired: string[] = []
    const ob = await Outbox.open({
      file: join(dir, 'outbox.json'),
      now: () => now,
      send: async () => {
        sends++
      },
      onSent: async () => {
        throw Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' })
      },
      onExpired: (item) => {
        expired.push(item.runId)
      },
      errorMessage: (e) => String(e)
    })
    await ob.add('run-1', mail, 'sem internet')
    ob.stop()
    now = new Date('2026-10-05T09:50:00Z')
    await expect(ob.processDue()).resolves.toBeUndefined()
    ob.stop()
    expect(sends).toBe(1)
    expect(expired).toEqual([])
    expect(ob.items()).toEqual([])
  })

  it('onExpired que falha não deixa a promessa rejeitada (timer usa `void processDue()`)', async () => {
    let now = new Date('2026-10-04T10:00:00Z')
    const ob = await Outbox.open({
      file: join(dir, 'outbox.json'),
      now: () => now,
      send: async () => {
        throw new Error('sem rede')
      },
      onSent: () => {},
      onExpired: async () => {
        throw new Error('histórico indisponível')
      },
      errorMessage: (e) => String(e)
    })
    await ob.add('run-2', mail, 'sem internet')
    ob.stop()
    now = new Date('2026-10-05T10:01:00Z')
    await expect(ob.processDue()).resolves.toBeUndefined()
    ob.stop()
    expect(ob.items()).toEqual([])
  })
})

describe('log anexado ao e-mail', () => {
  it('destinos com singular/plural e tamanho legível', () => {
    const run: RunRecord = {
      id: 'run',
      routineId: 'r',
      routineName: 'Financeiro',
      status: 'success',
      trigger: 'manual',
      startedAt: '2026-10-04T10:00:00.000Z',
      finishedAt: '2026-10-04T10:01:00.000Z',
      filesTotal: 1,
      filesCopied: 1,
      filesSkipped: 0,
      bytesTotal: 2048,
      bytesCopied: 2048,
      warnings: 0,
      errors: 0,
      destinationCount: 1,
      destinations: [
        {
          destinationId: 'd',
          path: 'E:\\',
          status: 'success',
          filesCopied: 1,
          bytesCopied: 2048,
          skipped: [],
          pruned: []
        }
      ],
      log: []
    }
    const t = runLogText(run, { computer: 'PC', appVersion: '0.1.0' })
    expect(t).not.toMatch(/\(s\)/)
    expect(t).toContain('1 arquivo, 2 KB')
  })
})

describe('e-mail do "Mover" com 1 arquivo', () => {
  it('concordância: "1 arquivo … apagado de … depois de conferido"', () => {
    const t = '2026-10-04T18:00:00.000Z'
    const run: RunRecord = {
      id: 'run',
      routineId: 'r',
      routineName: 'ERP',
      status: 'success',
      trigger: 'schedule',
      startedAt: t,
      finishedAt: t,
      filesTotal: 1,
      filesCopied: 1,
      filesSkipped: 0,
      bytesTotal: 1024,
      bytesCopied: 1024,
      warnings: 0,
      errors: 0,
      destinationCount: 1,
      destinations: [],
      log: [],
      filesMoved: 1,
      bytesMoved: 1024,
      move: {
        removed: [{ path: 'C:\\Backup\\erp.fbk', bytes: 1024, sha256: 'a'.repeat(64) }],
        removedCount: 1,
        removedBytes: 1024,
        kept: [],
        postponed: [],
        postponedCount: 0,
        sources: ['C:\\Backup']
      }
    }
    const { html } = renderRunEmail({
      run,
      routine: {
        name: 'ERP',
        notification: {
          enabled: true,
          recipients: ['a@b.com'],
          bcc: [],
          onSuccess: true,
          onWarning: true,
          onFailure: true,
          attachLog: 'never'
        }
      },
      settings: { clientName: '', computerAlias: '', companyName: 'BC Backup' },
      hostname: 'PC',
      appVersion: '0.1.0'
    })
    expect(html).toContain(' apagado de </span>')
    expect(html).toContain(' depois de conferido em todos os destinos')
    expect(html).not.toContain(' apagados de </span>')
  })
})
