import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTACTS, regionalCenter } from '../data/contacts.ts'

const all = [...CONTACTS, regionalCenter('Cusco')]

test('directory: every channel is verified and cites an official https source; no placeholders', () => {
  for (const c of all) for (const ch of c.channels) {
    assert.equal(ch.status, 'verificado', `${c.sigla} ${ch.value} is not verified`)
    assert.match(ch.source, /^https:\/\/.+/, `${c.sigla} ${ch.value} without source`)
    assert.ok(ch.value && !/pendiente|confirmar/i.test(ch.value + (ch.note ?? '')), `${c.sigla} has a placeholder or an unconfirmed remark`)
  }
})

test('directory: verified sources are official hosts only', () => {
  const official = /^https:\/\/(portal\.bomberosperu\.gob\.pe|portal\.indeci\.gob\.pe|www\.senamhi\.gob\.pe|biodiversidadanp\.sernanp\.gob\.pe)\//
  for (const c of all) for (const ch of c.channels) if (ch.status === 'verificado') assert.match(ch.source!, official, ch.source)
})

test('directory: unique ids, every institution has at least one real channel, regional center named after the region', () => {
  assert.equal(new Set(all.map((c) => c.id)).size, all.length)
  assert.ok(all.every((c) => c.channels.length > 0), 'a card without contact data')
  assert.match(regionalCenter('Cusco').name, /Cusco/)
})

test('directory: every institution and channel has its English text', () => {
  for (const c of all) {
    assert.ok(c.en.gloss && c.en.role, `${c.sigla} lacks English gloss/role`)
    assert.equal(!!c.note, !!c.en.note, `${c.sigla} note and English note must come together`)
    for (const ch of c.channels) {
      assert.ok(ch.en.label, `${c.sigla} ${ch.value} lacks an English label`)
      assert.equal(!!ch.note, !!ch.en.note, `${c.sigla} ${ch.value} note and English note must come together`)
    }
  }
})
