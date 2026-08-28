import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import fs from 'node:fs'
import QRCode from 'qrcode'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { abrirBanco } from './db.js'
import { criarCanal, agendarComDebounce } from './sse.js'
import { calcularAgregados } from './agregados.js'
import { registrarResposta, resultadoPessoal } from './respostas.js'
import * as questoes from './questoes.js'
import {
  criarRodada, rodadaAtual, entrarParticipante, questoesDoParticipante,
  marcarEntregue, definirFase, definirEntradas, definirPassoDebrief, zerarRodada
} from './rodada.js'

const PASTA_SRC = path.dirname(fileURLToPath(import.meta.url))
const PASTA_PUBLICA = path.join(PASTA_SRC, 'publico')
const COOKIE_PARTICIPANTE = 'pt'
const DEBOUNCE_PAINEL_MS = 500
const PING_MS = 25_000

// O ÚNICO formato que trafega no canal do participante. Se algo for
// acrescentado aqui, o teste de vazamento quebra — de propósito.
export function payloadDoParticipante (rodada) {
  return {
    fase: rodada.fase,
    segundosRelampago: rodada.segundos_relampago,
    segundosTrava: rodada.segundos_trava
  }
}

export function criarServidor (db, { adminKey = process.env.ADMIN_KEY, logger = false } = {}) {
  const app = Fastify({ logger })
  app.register(fastifyCookie)
  app.register(fastifyStatic, { root: PASTA_PUBLICA, prefix: '/' })
  // O CSV importado chega como texto cru.
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string' }, (req, corpo, done) => done(null, corpo))

  // O painel importa a mesma fórmula que o servidor usa. Uma fonte só.
  app.get('/distribuicao-cliente.js', (req, reply) => {
    reply.type('application/javascript')
    return fs.readFileSync(path.join(PASTA_SRC, 'distribuicao.js'), 'utf8')
  })

  // QR do link do quiz, para quem preferir o celular. Aponta para o host do
  // próprio pedido: local vira localhost, no VPS vira rtquiz.libtools.online.
  app.get('/qr.svg', async (req, reply) => {
    const proto = req.headers['x-forwarded-proto'] ?? req.protocol ?? 'https'
    const url = `${proto}://${req.headers.host}/quiz.html`
    const svg = await QRCode.toString(url, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#1d1846', light: '#ffffff' }
    })
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=3600')
    return svg
  })

  const canais = { participantes: criarCanal(), painel: criarCanal() }

  const emitirParticipantes = () => {
    const rodada = rodadaAtual(db)
    if (rodada) canais.participantes.publicar('estado', payloadDoParticipante(rodada))
  }
  const emitirPainel = agendarComDebounce(() => {
    const rodada = rodadaAtual(db)
    if (rodada) canais.painel.publicar('estado', estadoDoPainel(rodada))
  }, DEBOUNCE_PAINEL_MS)

  const estadoDoPainel = rodada => ({
    ...calcularAgregados(db, rodada.id),
    entradasAbertas: Boolean(rodada.entradas_abertas)
  })

  const ping = setInterval(() => {
    canais.participantes.manterVivo(); canais.painel.manterVivo()
  }, PING_MS)
  ping.unref?.()
  app.addHook('onClose', async () => {
    clearInterval(ping); canais.participantes.fechar(); canais.painel.fechar()
  })

  function participanteDoPedido (req, rodada) {
    const token = req.cookies?.[COOKIE_PARTICIPANTE]
    if (!token) return null
    return db.prepare('SELECT * FROM participante WHERE rodada_id = ? AND token = ?')
      .get(rodada.id, token) ?? null
  }

  function exigirRodada (reply) {
    const rodada = rodadaAtual(db)
    if (!rodada) { reply.code(503).send({ erro: 'nenhuma rodada aberta' }); return null }
    return rodada
  }

  // ---------- participante ----------

  app.post('/api/entrar', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const token = req.cookies?.[COOKIE_PARTICIPANTE] ?? randomUUID()

    let participante
    try {
      ;({ participante } = entrarParticipante(db, rodada.id, token))
    } catch (erro) {
      return reply.code(403).send({ erro: erro.message })
    }

    reply.setCookie(COOKIE_PARTICIPANTE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 12
    })
    emitirPainel()

    const jaRespondidas = db
      .prepare('SELECT questao_id FROM resposta WHERE participante_id = ?')
      .all(participante.id).map(l => l.questao_id)

    return {
      rotulo: participante.rotulo,
      fase: rodada.fase,
      segundosRelampago: rodada.segundos_relampago,
      segundosTrava: rodada.segundos_trava,
      questoes: questoesDoParticipante(db, participante.id),
      jaRespondidas
    }
  })

  // Carimba a exibição da questão: arma a trava e, no relâmpago, o cronômetro.
  app.post('/api/entregar', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const participante = participanteDoPedido(req, rodada)
    if (!participante) return reply.code(401).send({ erro: 'sem sessão' })
    marcarEntregue(db, participante.id, req.body?.questaoId)
    return { ok: true }
  })

  app.post('/api/responder', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const participante = participanteDoPedido(req, rodada)
    if (!participante) return reply.code(401).send({ erro: 'sem sessão' })

    const { questaoId, escolha, msParaResponder } = req.body ?? {}
    const r = registrarResposta(db, {
      participanteId: participante.id, questaoId, escolha, msParaResponder
    })
    if (!r.registrado) {
      const codigo = { ja_respondida: 409, cedo_demais: 425 }[r.motivo] ?? 400
      return reply.code(codigo).send({ motivo: r.motivo })
    }
    emitirPainel()
    // Devolve só o suficiente para o cliente avançar de tela. Nunca `correta`.
    return { ok: true, expirou: r.escolhaGravada === 'expirou' }
  })

  app.get('/api/meu-resultado', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const participante = participanteDoPedido(req, rodada)
    if (!participante) return reply.code(401).send({ erro: 'sem sessão' })
    if (rodada.fase !== 'revelado') {
      return reply.code(409).send({ erro: 'o resultado ainda não foi revelado' })
    }
    return resultadoPessoal(db, participante.id)
  })

  app.get('/stream', (req, reply) => {
    reply.hijack()
    canais.participantes.inscrever(reply.raw)
    const rodada = rodadaAtual(db)
    if (rodada) {
      reply.raw.write(`event: estado\ndata: ${JSON.stringify(payloadDoParticipante(rodada))}\n\n`)
    }
  })

  // ---------- painel ----------

  function temChave (req) {
    const oferecida = req.query?.k ?? req.cookies?.painel
    return Boolean(adminKey) && oferecida === adminKey
  }

  function exigirChave (req, reply) {
    if (temChave(req)) return true
    reply.code(401).send({ erro: 'chave inválida' })
    return false
  }

  app.post('/api/painel/rodada', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const { previsaoParticipantes, numQuestoesAtivas, segundosRelampago, segundosTrava } = req.body ?? {}
    if (!Number.isInteger(previsaoParticipantes) || previsaoParticipantes < 1) {
      return reply.code(400).send({ erro: 'previsaoParticipantes deve ser inteiro positivo' })
    }
    let rodada
    try {
      rodada = criarRodada(db, { previsaoParticipantes, numQuestoesAtivas, segundosRelampago, segundosTrava })
    } catch (erro) {
      return reply.code(400).send({ erro: erro.message })
    }
    emitirParticipantes(); emitirPainel()
    return { id: rodada.id, numQuestoesAtivas: rodada.num_questoes_ativas }
  })

  app.post('/api/painel/fase', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    try {
      definirFase(db, rodada.id, req.body?.fase)
    } catch (erro) {
      return reply.code(400).send({ erro: erro.message })
    }
    emitirParticipantes(); emitirPainel()
    return { ok: true }
  })

  app.post('/api/painel/entradas', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    definirEntradas(db, rodada.id, Boolean(req.body?.abertas))
    emitirPainel()
    return { ok: true }
  })

  app.post('/api/painel/debrief', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    definirPassoDebrief(db, rodada.id, Number(req.body?.passo ?? 0))
    emitirPainel()
    return { ok: true }
  })

  app.post('/api/painel/zerar', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    zerarRodada(db, rodada.id)
    emitirParticipantes(); emitirPainel()
    return { ok: true }
  })

  // ---------- gestão de questões ----------

  app.get('/api/painel/questoes', (req, reply) => {
    if (!exigirChave(req, reply)) return
    return questoes.listar(db)
  })

  const responderSalvar = (reply, r) => {
    if (r.ok) return r.questao
    const codigo = { invalida: 400, ja_existe: 409, nao_encontrada: 404 }[r.motivo] ?? 400
    return reply.code(codigo).send({ motivo: r.motivo, erros: r.erros ?? [] })
  }

  app.post('/api/painel/questoes', (req, reply) => {
    if (!exigirChave(req, reply)) return
    return responderSalvar(reply, questoes.salvar(db, req.body ?? {}, { criar: true }))
  })

  app.put('/api/painel/questoes/:id', (req, reply) => {
    if (!exigirChave(req, reply)) return
    return responderSalvar(reply, questoes.salvar(db, { ...(req.body ?? {}), id: req.params.id }))
  })

  app.delete('/api/painel/questoes/:id', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const r = questoes.apagar(db, req.params.id)
    if (r.ok) return { ok: true }
    return reply.code(r.motivo === 'em_uso' ? 409 : 404).send({ motivo: r.motivo, usos: r.usos })
  })

  app.get('/api/painel/questoes.csv', (req, reply) => {
    if (!exigirChave(req, reply)) return
    reply.type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="questoes.csv"')
    return questoes.paraCsv(questoes.listar(db))
  })

  app.post('/api/painel/questoes/importar', (req, reply) => {
    if (!exigirChave(req, reply)) return
    if (typeof req.body !== 'string') return reply.code(400).send({ erro: 'envie o CSV como text/csv' })
    const r = questoes.importarCsv(db, req.body)
    if (!r.ok) return reply.code(400).send(r)
    return r
  })

  app.get('/api/painel/estado', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    return estadoDoPainel(rodada)
  })

  app.get('/stream/painel', (req, reply) => {
    if (!temChave(req)) return reply.code(401).send({ erro: 'chave inválida' })
    reply.hijack()
    canais.painel.inscrever(reply.raw)
    const rodada = rodadaAtual(db)
    if (rodada) {
      reply.raw.write(`event: estado\ndata: ${JSON.stringify(estadoDoPainel(rodada))}\n\n`)
    }
  })

  return { app, canais, emitirParticipantes, emitirPainel }
}

export async function iniciar () {
  const db = abrirBanco()
  const { app } = criarServidor(db, { logger: true })
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  iniciar().catch(erro => { console.error(erro); process.exit(1) })
}
