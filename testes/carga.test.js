import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarServidor } from '../src/servidor.js'
import { criarRodada, definirFase } from '../src/rodada.js'
import { calcularAgregados } from '../src/agregados.js'

test('50 participantes simultâneos respondem sem perder nem duplicar resposta', async t => {
  const db = abrirBanco(':memory:')
  // Trava de zero: o teste é de concorrência, não de ritmo.
  const rodada = criarRodada(db, { previsaoParticipantes: 50, segundosTrava: 0 })
  definirFase(db, rodada.id, 'respondendo')
  const { app } = criarServidor(db, { adminKey: 'k' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => app.close())
  const base = `http://127.0.0.1:${app.server.address().port}`
  const json = { 'content-type': 'application/json' }

  async function umParticipante (n) {
    const entrada = await fetch(`${base}/api/entrar`, { method: 'POST', headers: json, body: '{}' })
    const cookie = entrada.headers.getSetCookie().find(c => c.startsWith('pt=')).split(';')[0]
    const { questoes } = await entrada.json()
    assert.equal(questoes.length, 5, `participante ${n} não recebeu 5 questões`)

    for (const q of questoes) {
      // Como o cliente: exibe (arma a trava) e depois responde.
      await fetch(`${base}/api/entregar`, { method: 'POST', headers: { ...json, cookie },
        body: JSON.stringify({ questaoId: q.id }) })
      const escolha = q.eRelampago ? 'confiro' : (n % 2 ? 'busca' : 'redacao')
      const r = await fetch(`${base}/api/responder`, { method: 'POST', headers: { ...json, cookie },
        body: JSON.stringify({ questaoId: q.id, escolha, msParaResponder: 1000 }) })
      assert.equal(r.status, 200, `participante ${n} falhou em ${q.id}: ${r.status}`)
    }
    return cookie
  }

  const cookies = await Promise.all(Array.from({ length: 50 }, (_, n) => umParticipante(n)))

  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.conectados, 50)
  assert.equal(ag.finalizados, 50)
  assert.equal(ag.placar.decisoes, 200)
  assert.equal(ag.relampago.cronometro.total + ag.relampago.controle.total, 50)
  assert.equal(ag.relampago.cronometro.total, 25)

  // Cada questão ativa recebeu uma fatia parecida do bolo.
  const usos = db.prepare(`
    SELECT q.gabarito, COUNT(*) c FROM resposta r
    JOIN questao q ON q.id = r.questao_id
    WHERE q.e_relampago = 0 GROUP BY r.questao_id
  `).all()
  for (const gabarito of ['busca', 'redacao']) {
    const c = usos.filter(u => u.gabarito === gabarito).map(u => u.c)
    assert.ok(Math.max(...c) - Math.min(...c) <= 1, `${gabarito}: ${c.join(',')}`)
  }

  // A trava resiste a uma rajada de reenvios concorrentes.
  const alvo = (await (await fetch(`${base}/api/entrar`, {
    method: 'POST', headers: { ...json, cookie: cookies[0] }, body: '{}'
  })).json()).questoes[0]
  const rajada = await Promise.all(Array.from({ length: 20 }, () =>
    fetch(`${base}/api/responder`, { method: 'POST', headers: { ...json, cookie: cookies[0] },
      body: JSON.stringify({ questaoId: alvo.id, escolha: 'busca' }) })))
  assert.ok(rajada.every(r => r.status === 409), 'toda tentativa extra deveria ser 409')
  assert.equal(calcularAgregados(db, rodada.id).placar.decisoes, 200, 'a trava deixou passar resposta extra')
})
