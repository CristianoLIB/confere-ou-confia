// scripts/carga.js — teste de escala contra um servidor de verdade.
//
//   node scripts/carga.js --url http://localhost:3000 --chave t --participantes 50
//
// Simula participantes completos (entrar, ler, responder as 5) com o mesmo
// ritmo do navegador, mantém telões conectados no SSE, mede latência por
// endpoint e confere a integridade dos dados no fim.

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map(p => p.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ') || 'true'])
)

const URL_BASE = (args.url ?? 'http://localhost:3000').replace(/\/$/, '')
const CHAVE = args.chave ?? process.env.ADMIN_KEY ?? 't'
const N = Number(args.participantes ?? 50)
const TELOES = Number(args.teloes ?? 2)
const TRAVA = Number(args.trava ?? 0)          // 0 mede o servidor; 4 simula o ritmo real
const ENTRADA_MS = Number(args.entrada ?? 8000) // janela em que a turma entra
const LEITURA_MS = Number(args.leitura ?? 1500) // quanto cada um "lê" além da trava
const REVELAR = args.revelar === 'true' || args.revelar === 'sim'
const MANTER = args.manter === 'true' || args.manter === 'sim'   // deixa a rodada viva no fim

const JSON_H = { 'content-type': 'application/json' }
const espera = ms => new Promise(r => setTimeout(r, ms))
const comChave = rota => `${URL_BASE}${rota}${rota.includes('?') ? '&' : '?'}k=${encodeURIComponent(CHAVE)}`

// ---------- medição ----------

const amostras = new Map()
const erros = new Map()
const cookies = []

async function medir (nome, fn) {
  const t0 = performance.now()
  try {
    const r = await fn()
    const ms = performance.now() - t0
    if (!amostras.has(nome)) amostras.set(nome, [])
    amostras.get(nome).push(ms)
    if (!r.ok) {
      const chave = `${nome} ${r.status}`
      erros.set(chave, (erros.get(chave) ?? 0) + 1)
    }
    return r
  } catch (e) {
    const chave = `${nome} ${e.cause?.code ?? e.name}`
    erros.set(chave, (erros.get(chave) ?? 0) + 1)
    return { ok: false, status: 0, json: async () => ({}) }
  }
}

const percentil = (lista, p) => {
  if (!lista.length) return 0
  const ordenada = [...lista].sort((a, b) => a - b)
  return ordenada[Math.min(ordenada.length - 1, Math.floor(ordenada.length * p))]
}

// ---------- um participante ----------

async function participante (n) {
  await espera(Math.random() * ENTRADA_MS)   // a turma não entra toda junta

  const entrada = await medir('entrar', () => fetch(`${URL_BASE}/api/entrar`, { method: 'POST', headers: JSON_H, body: '{}' }))
  if (!entrada.ok) return { n, ok: false, onde: 'entrar' }
  const cookie = (entrada.headers.getSetCookie?.() ?? []).find(c => c.startsWith('pt='))?.split(';')[0]
  const { questoes, segundosTrava } = await entrada.json()
  if (!cookie || !questoes) return { n, ok: false, onde: 'entrar-sem-sessao' }
  const cab = { ...JSON_H, cookie }

  cookies.push(cookie)

  for (const q of questoes) {
    await medir('entregar', () => fetch(`${URL_BASE}/api/entregar`, { method: 'POST', headers: cab, body: JSON.stringify({ questaoId: q.id }) }))
    // A trava do servidor mais o tempo de leitura de gente de verdade.
    await espera(segundosTrava * 1000 + Math.random() * LEITURA_MS + 150)
    const escolha = q.eRelampago ? (Math.random() < 0.6 ? 'confiro' : 'confio') : (Math.random() < 0.5 ? 'busca' : 'redacao')
    const r = await medir('responder', () => fetch(`${URL_BASE}/api/responder`, {
      method: 'POST', headers: cab, body: JSON.stringify({ questaoId: q.id, escolha, msParaResponder: 2000 })
    }))
    if (!r.ok) return { n, ok: false, onde: `responder ${r.status}` }
  }
  return { n, ok: true }
}

// ---------- observador ----------

// Uma requisição por segundo, sozinha, fora da rajada. Separa "o servidor
// ficou lento" de "o meu cliente enfileirou 1000 conexões".
async function observador (ate) {
  const ts = []
  while (Date.now() < ate) {
    const t = performance.now()
    try { await fetch(`${URL_BASE}/qr.svg`) } catch { /* ignora */ }
    ts.push(performance.now() - t)
    await espera(1000)
  }
  return ts
}

// ---------- telão ----------

async function telao (n, ate) {
  let eventos = 0
  try {
    const r = await fetch(comChave('/stream/painel'), { headers: { accept: 'text/event-stream' } })
    const leitor = r.body.getReader()
    const dec = new TextDecoder()
    while (Date.now() < ate) {
      const { value, done } = await leitor.read()
      if (done) break
      eventos += (dec.decode(value).match(/^event: estado$/gm) ?? []).length
    }
    leitor.cancel().catch(() => {})
  } catch { /* fim do teste */ }
  return { n, eventos }
}

// ---------- execução ----------

console.log(`\ncarga: ${N} participantes · ${TELOES} telões · trava ${TRAVA}s · ${URL_BASE}\n`)

const nova = await fetch(comChave('/api/painel/rodada'), {
  method: 'POST', headers: JSON_H,
  body: JSON.stringify({ previsaoParticipantes: N, segundosTrava: TRAVA })
})
if (!nova.ok) { console.error(`falhou ao criar a rodada: ${nova.status} — chave errada?`); process.exit(1) }
console.log(`rodada criada com ${(await nova.json()).numQuestoesAtivas} questões`)

// O custo de calcular os agregados é o que cresce com o público: cada evento
// do telão refaz as somas. Medir com a rodada vazia dá a linha de base.
async function medirAgregados (rotulo, vezes = 8) {
  const ts = []
  for (let i = 0; i < vezes; i++) {
    const t = performance.now()
    await fetch(comChave('/api/painel/estado'))
    ts.push(performance.now() - t)
  }
  const ord = ts.sort((a, b) => a - b)
  console.log(`  agregados ${rotulo.padEnd(22)} p50 ${Math.round(ord[Math.floor(vezes / 2)])}ms · max ${Math.round(ord.at(-1))}ms`)
}
console.log('')
await medirAgregados('com a rodada vazia')
await fetch(comChave('/api/painel/fase'), { method: 'POST', headers: JSON_H, body: JSON.stringify({ fase: 'respondendo' }) })

const t0 = performance.now()
const limite = Date.now() + ENTRADA_MS + (TRAVA * 5 + 12) * 1000
const [resultados, telas, observado] = await Promise.all([
  Promise.all(Array.from({ length: N }, (_, i) => participante(i))),
  Promise.all(Array.from({ length: TELOES }, (_, i) => telao(i, limite))),
  observador(limite)
])
const total = (performance.now() - t0) / 1000

// ---------- relatório ----------

const completos = resultados.filter(r => r.ok).length
console.log(`\ntempo total: ${total.toFixed(1)}s · completaram: ${completos}/${N}`)

console.log('\nlatência por chamada (ms)')
console.log('  endpoint      n     p50     p95     p99     max')
for (const [nome, lista] of amostras) {
  const f = v => String(Math.round(v)).padStart(7)
  console.log(`  ${nome.padEnd(10)} ${String(lista.length).padStart(4)}${f(percentil(lista, .5))}${f(percentil(lista, .95))}${f(percentil(lista, .99))}${f(Math.max(...lista))}`)
}
const totalReq = [...amostras.values()].reduce((s, l) => s + l.length, 0)
console.log(`\n  ${totalReq} requisições · ${(totalReq / total).toFixed(0)}/s de média`)
console.log(`  telões: ${telas.map(t => `${t.eventos} eventos`).join(' · ')}`)
console.log(`\n  observador (1 req/s, fora da rajada): p50 ${Math.round(percentil(observado, .5))}ms · p95 ${Math.round(percentil(observado, .95))}ms · max ${Math.round(Math.max(...observado))}ms`)
console.log('  se o observador está rápido e a rajada lenta, a fila é do cliente, não do servidor')

// ---------- integridade ----------

const ag = await (await fetch(comChave('/api/painel/estado'))).json()
const esperado = { conectados: N, finalizados: completos, decisoes: completos * 4 }
const real = { conectados: ag.conectados, finalizados: ag.finalizados, decisoes: ag.placar.decisoes }
const bate = JSON.stringify(esperado) === JSON.stringify(real)
console.log('\nintegridade')
console.log(`  esperado: ${JSON.stringify(esperado)}`)
console.log(`  no banco: ${JSON.stringify(real)}  ${bate ? '✓' : '✗'}`)
const rel = ag.relampago
console.log(`  relâmpago: ${rel.cronometro.total} com cronômetro · ${rel.controle.total} sem · ${rel.cronometro.expirados} expiraram`)
const porCat = ag.porCategoria.reduce((s, c) => s + c.total, 0)
console.log(`  categorias somam ${porCat} das ${real.decisoes} decisões  ${porCat === real.decisoes ? '✓' : '✗'}`)

// ---------- revelação, resultados e debrief ----------

let falhaDebrief = false
if (REVELAR) {
  console.log('\nrevelação')
  const tRev = performance.now()
  await fetch(comChave('/api/painel/fase'), { method: 'POST', headers: JSON_H, body: JSON.stringify({ fase: 'revelado' }) })
  console.log(`  revelar: ${Math.round(performance.now() - tRev)}ms`)

  // Todo mundo busca o placar pessoal ao mesmo tempo — é o pico real da
  // revelação, quando 1000 telas acendem juntas.
  const tRes = performance.now()
  const respostas = await Promise.all(cookies.map(c =>
    medir('meu-resultado', () => fetch(`${URL_BASE}/api/meu-resultado`, { headers: { cookie: c } }))))
  const okRes = respostas.filter(r => r.ok).length
  console.log(`  ${okRes}/${cookies.length} placares pessoais em ${((performance.now() - tRes) / 1000).toFixed(1)}s`)
  if (okRes < cookies.length) falhaDebrief = true

  const lista = amostras.get('meu-resultado') ?? []
  console.log(`  latência: p50 ${Math.round(percentil(lista, .5))}ms · p95 ${Math.round(percentil(lista, .95))}ms · max ${Math.round(Math.max(...lista))}ms`)

  const est = await (await fetch(comChave('/api/painel/estado'))).json()
  const passos = 2 + est.armadilhas.length + 2
  console.log(`\ndebrief (${passos} passos)`)
  for (let passo = 0; passo < passos; passo++) {
    const t = performance.now()
    await fetch(comChave('/api/painel/debrief'), { method: 'POST', headers: JSON_H, body: JSON.stringify({ passo }) })
    const e = await (await fetch(comChave('/api/painel/estado'))).json()
    if (e.passoDebrief !== passo) falhaDebrief = true
    process.stdout.write(`  passo ${passo}: ${Math.round(performance.now() - t)}ms   `)
  }
  console.log('')

  console.log('\no que o telão vai mostrar')
  console.log(`  placar: ${est.placar.acertos}/${est.placar.decisoes} = ${est.placar.percentual}%`)
  console.log(`  categorias (${est.porCategoria.length}): ${est.porCategoria.map(c => `${c.categoria} ${c.percentual}%`).join(' · ')}`)
  console.log(`  armadilhas: ${est.armadilhas.map(a => `${a.id} ${a.percentualErro}% erro (n ${a.total})`).join(' · ')}`)
  console.log(`  relâmpago: com cronômetro ${est.relampago.cronometro.percentual}% · sem ${est.relampago.controle.percentual}%`)
}

console.log('')
await medirAgregados(`com ${real.decisoes} respostas`)

if (MANTER) {
  await fetch(comChave('/api/painel/fase'), { method: 'POST', headers: JSON_H, body: JSON.stringify({ fase: 'respondendo' }) })
  console.log('\nrodada mantida em "respondendo" — dá para entrar e participar')
}

if (erros.size) {
  console.log('\nerros (todas as fases)')
  for (const [k, v] of [...erros].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`)
} else {
  console.log('\nerros: nenhum em nenhuma fase')
}

const problemas = !bate || erros.size > 0 || completos < N || falhaDebrief
console.log(problemas ? '\nRESULTADO: houve falhas — ver acima\n' : '\nRESULTADO: tudo íntegro\n')
process.exit(problemas ? 1 : 0)
