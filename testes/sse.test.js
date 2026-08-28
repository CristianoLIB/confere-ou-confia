import test from 'node:test'
import assert from 'node:assert/strict'
import { criarCanal, agendarComDebounce } from '../src/sse.js'

function falsoFluxo () {
  return {
    escrito: [], cabecalhos: null, ouvintes: {},
    writeHead (c, h) { this.cabecalhos = h },
    write (t) { this.escrito.push(t); return true },
    end () {},
    on (evento, fn) { this.ouvintes[evento] = fn }
  }
}

test('inscrever manda os cabeçalhos de event-stream', () => {
  const canal = criarCanal(); const fluxo = falsoFluxo()
  canal.inscrever(fluxo)
  assert.match(fluxo.cabecalhos['Content-Type'], /text\/event-stream/)
  assert.equal(canal.quantidade, 1)
})

test('publicar entrega o bloco SSE a todos os inscritos', () => {
  const canal = criarCanal(); const a = falsoFluxo(); const b = falsoFluxo()
  canal.inscrever(a); canal.inscrever(b)
  canal.publicar('estado', { fase: 'espera' })
  const bloco = 'event: estado\ndata: {"fase":"espera"}\n\n'
  assert.ok(a.escrito.includes(bloco))
  assert.ok(b.escrito.includes(bloco))
})

test('fechar a conexão remove o inscrito', () => {
  const canal = criarCanal(); const fluxo = falsoFluxo()
  canal.inscrever(fluxo)
  fluxo.ouvintes.close()
  assert.equal(canal.quantidade, 0)
})

test('um inscrito que estoura no write é descartado sem derrubar os outros', () => {
  const canal = criarCanal()
  const bom = falsoFluxo()
  const ruim = { ...falsoFluxo(), write () { throw new Error('EPIPE') } }
  canal.inscrever(ruim); canal.inscrever(bom)
  canal.publicar('estado', { fase: 'espera' })
  assert.equal(canal.quantidade, 1)
  assert.ok(bom.escrito.some(t => t.includes('estado')))
})

test('o debounce agrupa rajadas numa chamada só', async () => {
  let chamadas = 0
  const agendar = agendarComDebounce(() => chamadas++, 20)
  for (let i = 0; i < 50; i++) agendar()
  assert.equal(chamadas, 0)
  await new Promise(r => setTimeout(r, 40))
  assert.equal(chamadas, 1)
})
