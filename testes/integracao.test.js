import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarServidor, payloadDoParticipante } from '../src/servidor.js'
import { criarRodada, definirFase } from '../src/rodada.js'

const CHAVE = 'chave-de-teste'

// Trava de zero por padrão: os testes que não são sobre ela não esbarram nela.
function montarApp ({ previsao = 45, segundosTrava = 0 } = {}) {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: previsao, segundosTrava })
  const { app } = criarServidor(db, { adminKey: CHAVE })
  return { db, rodada, app }
}

async function entrar (app, cookie) {
  const r = await app.inject({
    method: 'POST', url: '/api/entrar',
    headers: cookie ? { cookie } : {}
  })
  return { corpo: r.json(), cookie: r.cookies.find(c => c.name === 'pt'), status: r.statusCode }
}

// Exibe a questão (arma a trava) e responde, como o cliente faz.
async function exibirEResponder (app, cookie, questaoId, escolha) {
  const cabecalhos = { cookie: `pt=${cookie.value}` }
  await app.inject({ method: 'POST', url: '/api/entregar', headers: cabecalhos, payload: { questaoId } })
  return app.inject({ method: 'POST', url: '/api/responder', headers: cabecalhos,
    payload: { questaoId, escolha, msParaResponder: 3000 } })
}

const comChave = url => `${url}${url.includes('?') ? '&' : '?'}k=${CHAVE}`

// ---------- participante ----------

test('entrar devolve as 5 questões, o rótulo, a fase e a duração da trava', async () => {
  const { rodada, db, app: a } = montarApp({ segundosTrava: 4 })
  definirFase(db, rodada.id, 'respondendo')
  const { corpo } = await entrar(a)
  assert.equal(corpo.questoes.length, 5)
  assert.equal(corpo.rotulo, 'Participante #1')
  assert.equal(corpo.fase, 'respondendo')
  assert.equal(corpo.segundosTrava, 4)
})

test('VAZAMENTO: a resposta de entrar não contém gabarito nem explicação', async () => {
  const { db, app: a } = montarApp()
  const { corpo } = await entrar(a)
  const texto = JSON.stringify(corpo)
  assert.ok(!texto.includes('gabarito'))
  assert.ok(!texto.includes('explicacao'))
  for (const { explicacao } of db.prepare('SELECT explicacao FROM questao').all()) {
    assert.ok(!texto.includes(explicacao), 'uma explicação vazou para o participante')
  }
})

test('VAZAMENTO: o payload do canal do participante só carrega fase e cronômetro', () => {
  const payload = payloadDoParticipante({
    id: 1, fase: 'respondendo', segundos_relampago: 10, segundos_trava: 4, passo_debrief: 3,
    previsao_participantes: 45, num_questoes_ativas: 10
  })
  assert.deepEqual(Object.keys(payload).sort(), ['fase', 'segundosRelampago', 'segundosTrava'])
})

test('VAZAMENTO: responder não diz se acertou', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const r = await exibirEResponder(a, cookie, corpo.questoes[0].id, 'busca')
  const texto = JSON.stringify(r.json())
  assert.ok(!texto.includes('correta'))
  assert.ok(!texto.includes('gabarito'))
  assert.equal(r.json().ok, true)
})

test('reabrir a página com o mesmo cookie retoma a sessão e as mesmas questões', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const primeira = await entrar(a)
  const segunda = await entrar(a, `pt=${primeira.cookie.value}`)
  assert.equal(segunda.corpo.rotulo, primeira.corpo.rotulo)
  assert.deepEqual(segunda.corpo.questoes.map(q => q.id), primeira.corpo.questoes.map(q => q.id))
  assert.equal(db.prepare('SELECT COUNT(*) c FROM participante').get().c, 1)
})

test('entrar devolve as questões já respondidas para o cliente retomar de onde parou', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const primeira = corpo.questoes[0].id
  await exibirEResponder(a, cookie, primeira, 'busca')
  const volta = await entrar(a, `pt=${cookie.value}`)
  assert.deepEqual(volta.corpo.jaRespondidas, [primeira])
})

test('A TRAVA pela API: a segunda resposta é recusada e o banco não muda', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const questaoId = corpo.questoes[0].id

  assert.equal((await exibirEResponder(a, cookie, questaoId, 'busca')).json().ok, true)
  const segunda = await exibirEResponder(a, cookie, questaoId, 'redacao')
  assert.equal(segunda.statusCode, 409)
  assert.equal(segunda.json().motivo, 'ja_respondida')
  assert.equal(db.prepare('SELECT escolha FROM resposta').get().escolha, 'busca')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 1)
})

test('A TRAVA DE ARMAÇÃO pela API: responder cedo devolve 425 e nada é gravado', async () => {
  const { db, rodada, app: a } = montarApp({ segundosTrava: 4 })
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const cedo = await exibirEResponder(a, cookie, corpo.questoes[0].id, 'busca')
  assert.equal(cedo.statusCode, 425)
  assert.equal(cedo.json().motivo, 'cedo_demais')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 0)
})

test('A TRAVA DE ARMAÇÃO pela API: pular o /api/entregar também é cedo demais', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const r = await a.inject({ method: 'POST', url: '/api/responder',
    headers: { cookie: `pt=${cookie.value}` },
    payload: { questaoId: corpo.questoes[0].id, escolha: 'busca' } })
  assert.equal(r.statusCode, 425)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 0)
})

test('meu-resultado responde 409 antes da revelação e 200 depois', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { cookie } = await entrar(a)
  const cabecalhos = { cookie: `pt=${cookie.value}` }

  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: cabecalhos })).statusCode, 409)
  definirFase(db, rodada.id, 'revelado')
  const depois = await a.inject({ url: '/api/meu-resultado', headers: cabecalhos })
  assert.equal(depois.statusCode, 200)
  assert.ok('acertos' in depois.json())
})

test('responder sem cookie de participante é recusado', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const r = await a.inject({ method: 'POST', url: '/api/responder',
    payload: { questaoId: 'B1', escolha: 'busca' } })
  assert.equal(r.statusCode, 401)
})

test('com as entradas fechadas, entrar devolve 403', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await a.inject({ method: 'POST', url: comChave('/api/painel/entradas'), payload: { abertas: false } })
  assert.equal((await entrar(a)).status, 403)
})

test('/qr.svg devolve um SVG apontando para o quiz no host do pedido', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: '/qr.svg', headers: { host: 'rtquiz.libtools.online', 'x-forwarded-proto': 'https' } })
  assert.equal(r.statusCode, 200)
  assert.match(r.headers['content-type'], /image\/svg\+xml/)
  assert.match(r.body, /^<svg/)
  assert.match(r.headers['cache-control'], /max-age/)
})

test('/qr.svg não exige chave: é o participante que escaneia', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/qr.svg' })).statusCode, 200)
})

test('o canal do participante devolve content-type de event-stream', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: '/stream', payloadAsStream: true })
  assert.match(r.headers['content-type'], /text\/event-stream/)
})

// ---------- painel ----------

test('as rotas do painel exigem a chave', async () => {
  const { app: a } = montarApp()
  for (const url of ['/api/painel/estado', '/stream/painel']) {
    assert.equal((await a.inject({ url })).statusCode, 401, url)
  }
  const semChave = await a.inject({ method: 'POST', url: '/api/painel/fase', payload: { fase: 'respondendo' } })
  assert.equal(semChave.statusCode, 401)
})

test('a chave errada também é recusada', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/api/painel/estado?k=errada' })).statusCode, 401)
})

test('criar rodada pelo painel dimensiona pela previsão e guarda a trava', async () => {
  const { db, app: a } = montarApp()
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'),
    payload: { previsaoParticipantes: 45, segundosTrava: 3 } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().numQuestoesAtivas, 10)
  assert.equal(db.prepare('SELECT segundos_trava FROM rodada ORDER BY id DESC LIMIT 1').get().segundos_trava, 3)
})

test('o painel recusa previsão inválida', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'), payload: { previsaoParticipantes: 0 } })
  assert.equal(r.statusCode, 400)
})

test('o painel troca a fase e o estado reflete', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/fase'), payload: { fase: 'respondendo' } })
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).json().fase, 'respondendo')
})

test('o painel recusa fase inválida', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/fase'), payload: { fase: 'cancelado' } })
  assert.equal(r.statusCode, 400)
})

test('o estado do painel traz os agregados completos', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await entrar(a)
  const estado = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  for (const campo of ['conectados', 'respondendo', 'finalizados', 'placar', 'porCategoria', 'armadilhas', 'relampago', 'entradasAbertas']) {
    assert.ok(campo in estado, `faltou ${campo}`)
  }
  assert.equal(estado.conectados, 1)
})

test('avançar o debrief guarda o passo', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/debrief'), payload: { passo: 3 } })
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).json().passoDebrief, 3)
})

test('zerar limpa os participantes e volta para espera', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await entrar(a)
  await a.inject({ method: 'POST', url: comChave('/api/painel/zerar') })
  const estado = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  assert.equal(estado.conectados, 0)
  assert.equal(estado.fase, 'espera')
})

test('o canal do painel devolve content-type de event-stream com a chave', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: comChave('/stream/painel'), payloadAsStream: true })
  assert.match(r.headers['content-type'], /text\/event-stream/)
})

// ---------- gestão de questões ----------

const NOVA = { id: 'N1', gabarito: 'busca', categoria: 'teste', texto: 'Enunciado.', explicacao: 'Regra.' }

test('a gestão de questões exige a chave em todas as rotas', async () => {
  const { app: a } = montarApp()
  const tentativas = [
    a.inject({ url: '/api/painel/questoes' }),
    a.inject({ method: 'POST', url: '/api/painel/questoes', payload: NOVA }),
    a.inject({ method: 'PUT', url: '/api/painel/questoes/B1', payload: NOVA }),
    a.inject({ method: 'DELETE', url: '/api/painel/questoes/B1' }),
    a.inject({ url: '/api/painel/questoes.csv' }),
    a.inject({ method: 'POST', url: '/api/painel/questoes/importar', headers: { 'content-type': 'text/csv' }, payload: 'id' })
  ]
  for (const r of await Promise.all(tentativas)) assert.equal(r.statusCode, 401)
})

test('criar, listar, editar e apagar uma questão pela API', async () => {
  const { app: a } = montarApp()
  const criada = await a.inject({ method: 'POST', url: comChave('/api/painel/questoes'), payload: NOVA })
  assert.equal(criada.statusCode, 200); assert.equal(criada.json().ativa, 1)
  assert.equal((await a.inject({ method: 'POST', url: comChave('/api/painel/questoes'), payload: NOVA })).statusCode, 409)

  assert.equal((await a.inject({ url: comChave('/api/painel/questoes') })).json().length, 22)

  const editada = await a.inject({ method: 'PUT', url: comChave('/api/painel/questoes/N1'), payload: { ...NOVA, texto: 'Editado.', ativa: false } })
  assert.equal(editada.json().texto, 'Editado.'); assert.equal(editada.json().ativa, 0)
  assert.equal((await a.inject({ method: 'PUT', url: comChave('/api/painel/questoes/ZZ'), payload: NOVA })).statusCode, 404)

  const invalida = await a.inject({ method: 'PUT', url: comChave('/api/painel/questoes/N1'), payload: { ...NOVA, gabarito: 'x' } })
  assert.equal(invalida.statusCode, 400); assert.ok(invalida.json().erros.length)

  assert.equal((await a.inject({ method: 'DELETE', url: comChave('/api/painel/questoes/N1') })).statusCode, 200)
  assert.equal((await a.inject({ method: 'DELETE', url: comChave('/api/painel/questoes/N1') })).statusCode, 404)
})

test('apagar questão em uso devolve 409', async () => {
  const { db, app: a } = montarApp()
  const usada = db.prepare('SELECT questao_id id FROM rodada_questao LIMIT 1').get().id
  const r = await a.inject({ method: 'DELETE', url: comChave(`/api/painel/questoes/${usada}`) })
  assert.equal(r.statusCode, 409); assert.equal(r.json().motivo, 'em_uso')
})

test('exportar devolve CSV com BOM e cabeçalho, importar aceita de volta', async () => {
  const { app: a } = montarApp()
  const exp = await a.inject({ url: comChave('/api/painel/questoes.csv') })
  assert.equal(exp.statusCode, 200)
  assert.match(exp.headers['content-type'], /text\/csv/)
  assert.match(exp.headers['content-disposition'], /questoes\.csv/)
  assert.ok(exp.body.startsWith('\uFEFF"id";"gabarito"'))

  const imp = await a.inject({ method: 'POST', url: comChave('/api/painel/questoes/importar'),
    headers: { 'content-type': 'text/csv' }, payload: exp.body })
  assert.equal(imp.statusCode, 200)
  assert.deepEqual(imp.json(), { ok: true, inseridas: 0, atualizadas: 21 })
})

test('importar com erro devolve 400 e os erros por linha', async () => {
  const { app: a } = montarApp()
  const csv = 'id;gabarito;categoria;texto;explicacao\nX1;nada;c;t;e\n'
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/questoes/importar'),
    headers: { 'content-type': 'text/csv' }, payload: csv })
  assert.equal(r.statusCode, 400)
  assert.equal(r.json().erros[0].linha, 2)
})

test('encerrar para todos: fase encerrado bloqueia entrada nova e o participante é avisado', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { cookie } = await entrar(a)
  const enc = await a.inject({ method: 'POST', url: comChave('/api/painel/fase'), payload: { fase: 'encerrado' } })
  assert.equal(enc.statusCode, 200)
  assert.equal((await entrar(a)).status, 403, 'ninguém novo entra')
  const volta = await entrar(a, `pt=${cookie.value}`)
  assert.equal(volta.status, 200, 'quem já estava dentro retoma')
  assert.equal(volta.corpo.fase, 'encerrado')
})
