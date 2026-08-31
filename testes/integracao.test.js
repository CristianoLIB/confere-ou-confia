import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarServidor, payloadDoParticipante, PAYLOAD_SEM_QUIZ } from '../src/servidor.js'
import { criarRodada, definirFase, zerarRodada } from '../src/rodada.js'

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
    id: 7, fase: 'respondendo', segundos_relampago: 10, segundos_trava: 4,
    animacao_relampago: 'raio', titulo: 'Buscar ou Redigir?',
    atalho: 'rt', passo_debrief: 3,
    previsao_participantes: 45, num_questoes_ativas: 10
  })
  assert.deepEqual(Object.keys(payload).sort(),
    ['animacaoRelampago', 'atalho', 'fase', 'noAr', 'resultadoLiberado', 'rodada',
     'segundosRelampago', 'segundosTrava', 'titulo'])
  assert.equal(payload.rodada, 7, 'o cliente precisa perceber quando a rodada trocou')
  assert.equal(payload.resultadoLiberado, false, 'o gate vem fechado por padrão')
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

// Responde as 5 questões de um participante, para ele ficar finalizado.
async function responderTudo (a, cookie, questoes) {
  const cab = { cookie: `pt=${cookie.value}` }
  for (const q of questoes) {
    await a.inject({ method: 'POST', url: '/api/entregar', headers: cab, payload: { questaoId: q.id } })
    await a.inject({ method: 'POST', url: '/api/responder', headers: cab,
      payload: { questaoId: q.id, escolha: q.eRelampago ? 'confiro' : 'busca' } })
  }
}

test('O GATE: revelar não libera o resultado individual; o fim do debrief libera', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  const cab = { cookie: `pt=${cookie.value}` }

  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: cab })).statusCode, 409, 'respondendo')

  definirFase(db, rodada.id, 'revelado')
  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: cab })).statusCode, 409,
    'revelar mostra o telão, não o placar pessoal')
  assert.equal((await entrar(a, `pt=${cookie.value}`)).corpo.resultadoLiberado, false)

  const { totalPassos } = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  assert.ok(totalPassos >= 4)
  // Um passo antes do fim ainda segura.
  await a.inject({ method: 'POST', url: comChave('/api/painel/debrief'), payload: { passo: totalPassos - 2 } })
  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: cab })).statusCode, 409)

  await a.inject({ method: 'POST', url: comChave('/api/painel/debrief'), payload: { passo: totalPassos - 1 } })
  const depois = await a.inject({ url: '/api/meu-resultado', headers: cab })
  assert.equal(depois.statusCode, 200, 'o fechamento abre o resultado')
  assert.ok('acertos' in depois.json())
  assert.equal((await entrar(a, `pt=${cookie.value}`)).corpo.resultadoLiberado, true)
})

test('O GATE: encerrar para todos também libera o resultado', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  definirFase(db, rodada.id, 'encerrado')
  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: { cookie: `pt=${cookie.value}` } })).statusCode, 200)
})

// ---------- histórico de sessões ----------

test('o histórico exige a chave', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/api/painel/sessoes' })).statusCode, 401)
  assert.equal((await a.inject({ url: '/api/painel/sessoes/1' })).statusCode, 401)
})

test('o histórico lista só sessões que tiveram gente, da mais recente para a mais antiga', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)

  const vazia = criarRodada(db, { previsaoParticipantes: 20 })
  const lista = (await a.inject({ url: comChave('/api/painel/sessoes') })).json()
  assert.equal(lista.length, 1, 'a rodada sem participantes não entra')
  assert.equal(lista[0].id, rodada.id)
  assert.equal(lista[0].participantes, 1)
  assert.equal(lista[0].finalizados, 1)
  assert.equal(lista[0].decisoes, 4, 'a relâmpago não conta como decisão')
  assert.ok(lista[0].percentual >= 0 && lista[0].percentual <= 100)
  assert.ok(!lista.some(s => s.id === vazia.id))
})

test('o histórico devolve os agregados completos de uma sessão antiga', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)

  // Uma rodada nova não pode apagar a leitura da anterior.
  const nova = criarRodada(db, { previsaoParticipantes: 30 })
  definirFase(db, nova.id, 'respondendo')

  const antiga = (await a.inject({ url: comChave(`/api/painel/sessoes/${rodada.id}`) })).json()
  assert.equal(antiga.id, rodada.id)
  assert.equal(antiga.placar.decisoes, 4)
  assert.ok(antiga.criadaEm)
  assert.ok(Array.isArray(antiga.porCategoria))
  assert.ok('relampago' in antiga)
  assert.equal((await a.inject({ url: comChave('/api/painel/sessoes/9999') })).statusCode, 404)
})

test('as categorias chegam ao telão acentuadas', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  const { porCategoria } = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  for (const c of porCategoria) {
    assert.ok(!/estatistico|citacao|sintese|proprio|adaptacao|geracao|relampago/.test(c.categoria),
      `categoria sem acento no telão: ${c.categoria}`)
  }
  const todas = db.prepare('SELECT DISTINCT categoria FROM questao').all().map(l => l.categoria)
  assert.ok(todas.includes('síntese de material próprio'))
  assert.ok(todas.includes('relâmpago'))
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

test('/qr.svg devolve um SVG e não fica preso em cache quando o atalho muda', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: '/qr.svg', headers: { host: 'rtquiz.libtools.online', 'x-forwarded-proto': 'https' } })
  assert.equal(r.statusCode, 200)
  assert.match(r.headers['content-type'], /image\/svg\+xml/)
  assert.match(r.body, /^<svg/)
  assert.match(r.headers['cache-control'], /no-cache/, 'o atalho muda no painel; o QR precisa acompanhar')
})

// ---------- atalho: a URL que o telão manda digitar ----------

test('ATALHO: a URL curta abre o quiz sem redirecionar', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: '/rt' })
  assert.equal(r.statusCode, 200)
  assert.match(r.body, /RTQuiz/, 'serve o quiz na própria URL curta')
  assert.match(r.body, /quiz\.js/)
})

test('ATALHO: continua funcionando com barra no fim', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/rt/' })).statusCode, 200)
})

test('ATALHO: um caminho que não é o atalho segue 404', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/outracoisa' })).statusCode, 404)
  assert.equal((await a.inject({ url: '/' })).statusCode, 404)
})

test('ATALHO: não atrapalha os arquivos nem a API', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  for (const url of ['/quiz.html', '/comum.css', '/quiz.js', '/telao.js', '/qr.svg']) {
    assert.equal((await a.inject({ url })).statusCode, 200, url)
  }
  assert.equal((await a.inject({ method: 'POST', url: '/api/entrar' })).statusCode, 200)
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).statusCode, 200)
})

test('ATALHO: mudar no painel troca a URL curta na hora', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { atalho: 'rt-28-08-2026' } })
  assert.equal((await a.inject({ url: '/rt-28-08-2026' })).statusCode, 200)
  assert.equal((await a.inject({ url: '/rt' })).statusCode, 404, 'o antigo deixa de valer')
})

test('ATALHO: é normalizado — acento, espaço e maiúscula viram hífen e minúscula', async () => {
  const { app: a } = montarApp()
  const ajustar = atalho => a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { atalho } })
  assert.equal((await ajustar('  Reunião Técnica 2026 ')).json().atalho, 'reuniao-tecnica-2026')
  assert.equal((await ajustar('RT//28')).json().atalho, 'rt-28')
  assert.equal((await ajustar('---')).json().atalho, 'rt-28', 'vazio depois de limpar mantém o anterior')
})

test('ATALHO: nomes que já são rota são recusados', async () => {
  const { app: a } = montarApp()
  const ajustar = atalho => a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { atalho } })
  await ajustar('rt')
  for (const reservado of ['api', 'stream', 'favicon']) {
    assert.equal((await ajustar(reservado)).json().atalho, 'rt', `${reservado} sequestraria a aplicação`)
  }
  // E a API continua respondendo.
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).statusCode, 200)
})

test('ATALHO: criar rodada e arquivar preservam o atalho', async () => {
  const { db, app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'),
    payload: { previsaoParticipantes: 30, atalho: 'pilula-3' } })
  assert.equal(db.prepare('SELECT atalho FROM rodada ORDER BY id DESC LIMIT 1').get().atalho, 'pilula-3')
  definirFase(db, db.prepare('SELECT MAX(id) id FROM rodada').get().id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  const { nova } = (await a.inject({ method: 'POST', url: comChave('/api/painel/arquivar') })).json()
  assert.equal(db.prepare('SELECT atalho FROM rodada WHERE id = ?').get(nova).atalho, 'pilula-3')
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

// ---------- sessão órfã: o ensaio que quebrava o participante ----------

test('SESSÃO ÓRFÃ: zerar a rodada faz o participante aberto receber 401', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const cabecalhos = { cookie: `pt=${cookie.value}` }
  const questaoId = corpo.questoes[0].id

  zerarRodada(db, rodada.id)
  definirFase(db, rodada.id, 'respondendo')

  for (const url of ['/api/entregar', '/api/responder']) {
    const r = await a.inject({ method: 'POST', url, headers: cabecalhos, payload: { questaoId, escolha: 'busca' } })
    assert.equal(r.statusCode, 401, `${url} devolve 401 com sessão órfã`)
  }
})

test('SESSÃO ÓRFÃ: entrar de novo com o mesmo cookie recupera a sessão', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const primeira = await entrar(a)
  zerarRodada(db, rodada.id)
  definirFase(db, rodada.id, 'respondendo')

  const volta = await entrar(a, `pt=${primeira.cookie.value}`)
  assert.equal(volta.status, 200, 'reentrar é o caminho de recuperação do cliente')
  assert.equal(volta.corpo.questoes.length, 5)
  assert.deepEqual(volta.corpo.jaRespondidas, [], 'participante novo, placar limpo')
  assert.equal(volta.corpo.rotulo, 'Participante #1')
})

test('SESSÃO ÓRFÃ: criar uma rodada nova também troca o id que o cliente observa', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const antes = await entrar(a)
  assert.equal(antes.corpo.rodada, rodada.id)

  const nova = criarRodada(db, { previsaoParticipantes: 20 })
  definirFase(db, nova.id, 'respondendo')
  const depois = await entrar(a, `pt=${antes.cookie.value}`)
  assert.equal(depois.corpo.rodada, nova.id, 'o cliente precisa ver que mudou de rodada')
  assert.notEqual(nova.id, rodada.id)
})

// ---------- arquivar ----------

test('arquivar exige a chave', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ method: 'POST', url: '/api/painel/arquivar' })).statusCode, 401)
})

test('ARQUIVAR preserva a sessão no histórico e abre uma nova igual', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)

  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/arquivar') })
  assert.equal(r.statusCode, 200)
  const { arquivada, nova } = r.json()
  assert.equal(arquivada, rodada.id)
  assert.notEqual(nova, rodada.id)

  // A antiga continua inteira e visível no histórico.
  const antiga = db.prepare('SELECT * FROM rodada WHERE id = ?').get(arquivada)
  assert.equal(antiga.fase, 'encerrado')
  const sessoes = (await a.inject({ url: comChave('/api/painel/sessoes') })).json()
  assert.ok(sessoes.some(x => x.id === arquivada && x.decisoes === 4))

  // A nova herda os parâmetros e começa vazia.
  const atual = db.prepare('SELECT * FROM rodada WHERE id = ?').get(nova)
  assert.equal(atual.previsao_participantes, antiga.previsao_participantes)
  assert.equal(atual.segundos_trava, antiga.segundos_trava)
  assert.equal(atual.fase, 'espera')
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).json().conectados, 0)
})

test('ZERAR apaga só a sessão atual: as anteriores continuam no histórico', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const primeira = await entrar(a)
  await responderTudo(a, primeira.cookie, primeira.corpo.questoes)

  // Arquiva e monta uma segunda sessão.
  const { nova } = (await a.inject({ method: 'POST', url: comChave('/api/painel/arquivar') })).json()
  definirFase(db, nova, 'respondendo')
  const segunda = await entrar(a, 'pt=outro-token')
  await responderTudo(a, segunda.cookie, segunda.corpo.questoes)

  const questoesAntes = db.prepare('SELECT COUNT(*) c FROM questao').get().c
  await a.inject({ method: 'POST', url: comChave('/api/painel/zerar') })

  const sessoes = (await a.inject({ url: comChave('/api/painel/sessoes') })).json()
  assert.ok(sessoes.some(x => x.id === rodada.id), 'a sessão arquivada sobrevive ao zerar')
  assert.ok(!sessoes.some(x => x.id === nova), 'a sessão zerada sai do histórico')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM rodada').get().c, 2, 'nenhuma rodada é removida')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM questao').get().c, questoesAntes, 'o banco de questões não é tocado')
})

// ---------- ritmo ajustável ----------

test('os ajustes exigem a chave', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ method: 'POST', url: '/api/painel/ajustes', payload: {} })).statusCode, 401)
})

test('AJUSTES: mudam a rodada em andamento e chegam ao participante', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const antes = await entrar(a)
  assert.equal(antes.corpo.animacaoRelampago, 'raio')

  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'),
    payload: { segundosTrava: 6, segundosRelampago: 15, animacaoRelampago: 'flash' } })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { segundosTrava: 6, segundosRelampago: 15,
    animacaoRelampago: 'flash', titulo: 'Confere ou Confia?', atalho: 'rt' })

  // Sem criar rodada nova: o mesmo participante já recebe o novo ritmo.
  const depois = await entrar(a, `pt=${antes.cookie.value}`)
  assert.equal(depois.corpo.rodada, rodada.id, 'é a mesma rodada')
  assert.equal(depois.corpo.segundosTrava, 6)
  assert.equal(depois.corpo.animacaoRelampago, 'flash')
})

test('AJUSTES: o servidor limita os valores e ignora animação inválida', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'),
    payload: { segundosTrava: 999, segundosRelampago: 1, animacaoRelampago: 'discoteca' } })
  assert.deepEqual(r.json(), { segundosTrava: 15, segundosRelampago: 3,
    animacaoRelampago: 'raio', titulo: 'Confere ou Confia?', atalho: 'rt' })
})

test('AJUSTES: mexer num campo não altera os outros', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'),
    payload: { segundosTrava: 7, animacaoRelampago: 'nenhuma' } })
  const so = await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { segundosRelampago: 30 } })
  assert.deepEqual(so.json(), { segundosTrava: 7, segundosRelampago: 30,
    animacaoRelampago: 'nenhuma', titulo: 'Confere ou Confia?', atalho: 'rt' })
})

test('AJUSTES: o painel mostra o ritmo em uso', async () => {
  const { app: a } = montarApp()
  const estado = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  assert.deepEqual(Object.keys(estado.ajustes).sort(),
    ['animacaoRelampago', 'atalho', 'segundosRelampago', 'segundosTrava', 'titulo'])
})

test('criar rodada aceita o ritmo e a animação', async () => {
  const { db, app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'),
    payload: { previsaoParticipantes: 30, segundosTrava: 6, animacaoRelampago: 'flash' } })
  const r = db.prepare('SELECT * FROM rodada ORDER BY id DESC LIMIT 1').get()
  assert.equal(r.segundos_trava, 6)
  assert.equal(r.animacao_relampago, 'flash')
})

// ---------- título da dinâmica ----------

test('TÍTULO: cada rodada tem o seu, editável sem mexer em código', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  assert.equal((await entrar(a)).corpo.titulo, 'Confere ou Confia?', 'o padrão é o tema desta pílula')

  await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { titulo: '  Buscar   ou  Redigir?  ' } })
  const depois = await entrar(a)
  assert.equal(depois.corpo.titulo, 'Buscar ou Redigir?', 'apara e normaliza os espaços')
  assert.equal(depois.corpo.rodada, rodada.id, 'sem precisar criar rodada nova')
})

test('TÍTULO: vazio volta ao anterior, e o limite protege o cabeçalho do telão', async () => {
  const { app: a } = montarApp()
  const ajustar = titulo => a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { titulo } })
  await ajustar('Um tema qualquer')
  assert.equal((await ajustar('   ')).json().titulo, 'Um tema qualquer', 'não aceita apagar o título')
  assert.equal((await ajustar('x'.repeat(200))).json().titulo.length, 60)
})

test('TÍTULO: criar rodada aceita o tema, e arquivar o herda', async () => {
  const { db, app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'),
    payload: { previsaoParticipantes: 30, titulo: 'Pílula 2 — Prompts' } })
  assert.equal(db.prepare('SELECT titulo FROM rodada ORDER BY id DESC LIMIT 1').get().titulo, 'Pílula 2 — Prompts')

  definirFase(db, db.prepare('SELECT MAX(id) id FROM rodada').get().id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  const { nova } = (await a.inject({ method: 'POST', url: comChave('/api/painel/arquivar') })).json()
  assert.equal(db.prepare('SELECT titulo FROM rodada WHERE id = ?').get(nova).titulo, 'Pílula 2 — Prompts',
    'a próxima turma continua com o mesmo tema')
})

test('TÍTULO: o histórico identifica cada sessão pelo tema', async () => {
  const { db, rodada, app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/ajustes'), payload: { titulo: 'Confere ou Confia?' } })
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  const lista = (await a.inject({ url: comChave('/api/painel/sessoes') })).json()
  assert.equal(lista[0].titulo, 'Confere ou Confia?')
  const uma = (await a.inject({ url: comChave(`/api/painel/sessoes/${rodada.id}`) })).json()
  assert.equal(uma.titulo, 'Confere ou Confia?')
})

// ---------- fora do ar ----------

test('SEM QUIZ: banco sem rodada nenhuma recusa o participante com motivo próprio', async () => {
  const db = abrirBanco(':memory:')
  const { app } = criarServidor(db, { adminKey: CHAVE })
  const r = await app.inject({ method: 'POST', url: '/api/entrar' })
  assert.equal(r.statusCode, 503)
  assert.equal(r.json().motivo, 'sem_quiz', 'o cliente precisa distinguir isso de entradas fechadas')
})

test('SEM QUIZ: tirar do ar fecha a porta para todos, inclusive quem já entrou', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  await responderTudo(a, cookie, corpo.questoes)
  const cab = { cookie: `pt=${cookie.value}` }
  definirFase(db, rodada.id, 'encerrado')
  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: cab })).statusCode, 200, 'antes de tirar do ar via o resultado')

  const fora = await a.inject({ method: 'POST', url: comChave('/api/painel/no-ar'), payload: { noAr: false } })
  assert.equal(fora.statusCode, 200)

  // Nada mais responde ao participante, nem o resultado de antes.
  for (const [metodo, url] of [['POST', '/api/entrar'], ['POST', '/api/entregar'], ['POST', '/api/responder'], ['GET', '/api/meu-resultado']]) {
    const r = await a.inject({ method: metodo, url, headers: cab, payload: {} })
    assert.equal(r.statusCode, 503, url)
    assert.equal(r.json().motivo, 'sem_quiz', url)
  }
})

test('SEM QUIZ: o atalho continua abrindo a página, que mostra a porta fechada', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/rt' })).statusCode, 200)
  await a.inject({ method: 'POST', url: comChave('/api/painel/no-ar'), payload: { noAr: false } })
  const r = await a.inject({ url: '/rt' })
  assert.equal(r.statusCode, 200, 'quem tem o link salvo veria um 404 cru do navegador')
  assert.match(r.body, /quiz\.js/, 'é a página do participante que decide o que mostrar')
  // Mas a API por trás continua fechada.
  assert.equal((await a.inject({ method: 'POST', url: '/api/entrar' })).json().motivo, 'sem_quiz')
})

test('SEM QUIZ: o payload do canal não vaza nada da rodada apagada', () => {
  assert.deepEqual(PAYLOAD_SEM_QUIZ, { noAr: false })
})

test('SEM QUIZ: voltar ao ar restaura tudo', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await a.inject({ method: 'POST', url: comChave('/api/painel/no-ar'), payload: { noAr: false } })
  assert.equal((await entrar(a)).status, 503)
  await a.inject({ method: 'POST', url: comChave('/api/painel/no-ar'), payload: { noAr: true } })
  const volta = await entrar(a)
  assert.equal(volta.status, 200)
  assert.equal(volta.corpo.questoes.length, 5)
})

test('SEM QUIZ: o painel continua funcionando com a dinâmica fora do ar', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/no-ar'), payload: { noAr: false } })
  const estado = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  assert.equal(estado.noAr, false, 'o host precisa ver em que estado está')
  assert.equal((await a.inject({ url: comChave('/api/painel/sessoes') })).statusCode, 200)
  assert.equal((await a.inject({ url: comChave('/api/painel/questoes') })).statusCode, 200)
})

test('SEM QUIZ: a rodada nasce no ar', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'), payload: { previsaoParticipantes: 20 } })
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).json().noAr, true)
})
