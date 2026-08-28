import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrirBanco } from '../src/db.js'
import { montarPassos, larguraSegmentos } from '../src/publico/telao.js'

const PUBLICO = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src', 'publico')
const ler = arquivo => fs.readFileSync(path.join(PUBLICO, arquivo), 'utf8')

// ---------- participante ----------

test('a tela do participante não embute gabarito nem explicação', () => {
  const fonte = ler('quiz.html') + ler('quiz.js')
  const questoes = abrirBanco(':memory:').prepare('SELECT texto, explicacao FROM questao').all()
  for (const q of questoes) {
    assert.ok(!fonte.includes(q.explicacao), 'uma explicação está embutida na tela do quiz')
    assert.ok(!fonte.includes(q.texto), 'um enunciado está embutido na tela do quiz')
  }
})

test('a tela do participante não chama nenhuma rota do painel', () => {
  const fonte = ler('quiz.js')
  assert.ok(!fonte.includes('/api/painel'))
  assert.ok(!fonte.includes('/stream/painel'))
})

test('nenhum módulo do servidor identifica ou bloqueia por IP', () => {
  const SRC = path.dirname(PUBLICO)
  for (const arquivo of fs.readdirSync(SRC).filter(a => a.endsWith('.js'))) {
    const fonte = fs.readFileSync(path.join(SRC, arquivo), 'utf8')
    assert.ok(!/req\.ip|remoteAddress|x-forwarded-for/i.test(fonte),
      `${arquivo} usa o IP do participante, e a spec proíbe: na reunião online cada um vem de uma rede, mas a trava é o token, nunca o IP`)
  }
})

test('as três telas existem e declaram a folha compartilhada', () => {
  for (const arquivo of ['quiz.html', 'telao.html', 'painel.html']) {
    assert.match(ler(arquivo), /comum\.css/, `${arquivo} não carrega comum.css`)
  }
})

test('a paleta é a da marca, e não o par verde/vermelho reprovado', () => {
  const css = ler('comum.css')
  assert.match(css, /--navy:\s*#29235c/)
  assert.match(css, /--laranja:\s*#ff8000/)
  assert.match(css, /--teal:\s*#169194/)
  assert.ok(!/#0ca30c/i.test(css), 'o verde reprovado no gate de daltonismo voltou')
  assert.ok(!/#d03b3b/i.test(css), 'o vermelho reprovado no gate de daltonismo voltou')
})

test('nada de canto arredondado nem sombra difusa: a composição é chapada', () => {
  const css = ler('comum.css')
  assert.ok(!/border-radius/.test(css), 'canto arredondado não pertence a esta composição')
  for (const sombra of css.match(/box-shadow:[^;]+/g) ?? []) {
    // Cada sombra da lista precisa ter desfoque zero: "x y 0 cor" ou "inset 0 0 0 2px".
    for (const uma of sombra.replace('box-shadow:', '').split(',')) {
      if (/none/.test(uma)) continue
      const partes = uma.trim().replace(/^inset\s+/, '').split(/\s+/)
      assert.equal(partes[2], '0', `sombra com desfoque em "${uma.trim()}" — o relevo é bloco de aresta dura`)
    }
  }
})

test('o botão travado perde o relevo', () => {
  const css = ler('comum.css')
  const travado = css.match(/\.opcao:disabled\s*\{[^}]*\}/)
  assert.ok(travado, 'falta o estado :disabled do botão')
  assert.match(travado[0], /box-shadow:\s*none/, 'travado não é apertável, então não pode parecer levantado')
})

test('o quiz carimba a entrega de toda questão, não só do relâmpago', () => {
  const fonte = ler('quiz.js')
  assert.match(fonte, /\/api\/entregar/)
  const trecho = fonte.slice(Math.max(0, fonte.indexOf('/api/entregar') - 400), fonte.indexOf('/api/entregar'))
  assert.ok(!/eRelampago[^\n]*\)\s*\{[^}]*$/.test(trecho),
    'entregar precisa valer para toda questão: é o que arma a trava')
})

test('o aviso da trava fala com o participante a cada questão', () => {
  assert.match(ler('quiz.js'), /liberam em/, 'o participante precisa saber por que os botões estão mortos')
})

test('só o grupo do cronômetro lê o aviso dos 10 segundos', () => {
  const fonte = ler('quiz.js')
  const preparacao = fonte.slice(fonte.indexOf('function desenharPreparacao'))
  assert.match(preparacao, /comCronometro/,
    'a tela de preparação precisa ramificar por grupo — o aviso de tempo é o próprio tratamento do A/B')
})

// ---------- telão ----------

const agregadoFalso = (armadilhas = 3) => ({
  fase: 'revelado', passoDebrief: 0,
  conectados: 48, respondendo: 4, finalizados: 44,
  placar: { decisoes: 176, acertos: 132, percentual: 75 },
  porCategoria: [{ categoria: 'sintese de material proprio', total: 40, acertos: 36, percentual: 90 }],
  armadilhas: Array.from({ length: armadilhas }, (_, i) => ({
    id: `Q${i}`, texto: 't', gabarito: 'busca', explicacao: 'e', total: 18, acertos: 6, percentualErro: 67
  })),
  relampago: {
    cronometro: { total: 24, acertos: 12, expirados: 3, percentual: 50 },
    controle: { total: 24, acertos: 19, expirados: 0, percentual: 79 }
  }
})

test('o debrief tem placar, categorias, uma tela por armadilha, o A/B e o fechamento', () => {
  const passos = montarPassos(agregadoFalso(3))
  assert.deepEqual(passos.map(p => p.tipo),
    ['placar', 'categorias', 'armadilha', 'armadilha', 'armadilha', 'relampago', 'fechamento'])
})

test('sem armadilhas suficientes o debrief encurta sozinho', () => {
  assert.deepEqual(montarPassos(agregadoFalso(0)).map(p => p.tipo),
    ['placar', 'categorias', 'relampago', 'fechamento'])
})

test('os segmentos da barra somam 100% e o vão nunca some', () => {
  const larguras = larguraSegmentos([{ valor: 12 }, { valor: 5 }, { valor: 1 }])
  assert.equal(Math.round(larguras.reduce((s, l) => s + l, 0)), 100)
  assert.ok(larguras.every(l => l > 0))
})

test('barra com um segmento só ocupa a largura inteira', () => {
  assert.deepEqual(larguraSegmentos([{ valor: 9 }]), [100])
})

test('barra sem dado nenhum não vira NaN', () => {
  assert.deepEqual(larguraSegmentos([]), [])
  assert.deepEqual(larguraSegmentos([{ valor: 0 }, { valor: 0 }]), [0, 0])
})

test('o telão não embute a chave do painel no código', () => {
  const fonte = ler('telao.js') + ler('telao.html')
  assert.ok(!/ADMIN_KEY|chave-de-teste/.test(fonte), 'a chave deve vir da URL, nunca embutida')
})

// ---------- painel ----------

test('o painel prevê o número de questões antes de criar a rodada', async () => {
  const { calcularQuestoesAtivas } = await import('../src/distribuicao.js')
  assert.match(ler('painel.js'), /calcularQuestoesAtivas/, 'o painel precisa mostrar a previsão antes de confirmar')
  assert.equal(calcularQuestoesAtivas(45), 10)
})

test('o painel avisa que não deve ser compartilhado', () => {
  assert.match(ler('painel.html'), /não compartilhe|nao compartilhe/i)
})

test('o painel manda a trava ao criar a rodada', () => {
  assert.match(ler('painel.js'), /segundosTrava/)
})
