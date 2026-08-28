export function criarCanal () {
  const inscritos = new Set()
  const descartar = raw => inscritos.delete(raw)

  return {
    inscrever (raw) {
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      inscritos.add(raw)
      raw.on('close', () => descartar(raw))
      raw.on('error', () => descartar(raw))
      // O primeiro write já pode estourar num socket que fechou no caminho.
      try { raw.write(': conectado\n\n') } catch { descartar(raw) }
      return () => descartar(raw)
    },
    publicar (evento, dados) {
      const bloco = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`
      for (const raw of [...inscritos]) {
        try { raw.write(bloco) } catch { descartar(raw) }
      }
    },
    manterVivo () {
      for (const raw of [...inscritos]) {
        try { raw.write(': ping\n\n') } catch { descartar(raw) }
      }
    },
    fechar () {
      for (const raw of [...inscritos]) { try { raw.end() } catch { /* já caiu */ } }
      inscritos.clear()
    },
    get quantidade () { return inscritos.size }
  }
}

export function agendarComDebounce (fn, ms) {
  let temporizador = null
  return () => {
    if (temporizador) return
    temporizador = setTimeout(() => { temporizador = null; fn() }, ms)
    temporizador.unref?.()
  }
}
