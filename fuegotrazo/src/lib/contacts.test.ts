import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTACTS, regionalCenter } from '../data/contacts.ts'

const all = [...CONTACTS, regionalCenter('Cusco')]

test('directory: a channel is "verificado" only with an official source URL; placeholders never carry a number', () => {
  for (const c of all) for (const ch of c.channels) {
    if (ch.status === 'verificado') assert.match(ch.source ?? '', /^https:\/\/.+/, `${c.sigla} ${ch.value} verified without source`)
    assert.ok(ch.value && !/pendiente/i.test(ch.value), `${c.sigla} has an empty or placeholder channel`)
    if (ch.status === 'sin_confirmar') assert.ok(ch.note, `${c.sigla} ${ch.value} unconfirmed without explanation`)
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
