'use client'
import { useEffect, useState, useRef } from 'react'

type Passo = {
  face: string
  tag: string
  tagBg: string
  tagColor: string
  title: string
  text: string
  highlightId?: string
  arrowId?: string
  nextLabel: string
  nextBg: string
  accent: string
  particles?: boolean
  showDismiss?: boolean
  last?: boolean
}

type Props = {
  passos: Passo[]
  storageKey: string
  onClose: () => void
}

export default function TourGuiado({ passos, storageKey, onClose }: Props) {
  const [cur, setCur] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [splRect, setSplRect] = useState<{top:number;left:number;w:number;h:number}|null>(null)
  const [arrowRect, setArrowRect] = useState<{top:number;left:number;w:number;h:number}|null>(null)
  const [isMouthing, setIsMouthing] = useState(false)
  const typingRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<NodeJS.Timeout|null>(null)
  const mouthRef = useRef<NodeJS.Timeout|null>(null)
  const audioCtxRef = useRef<AudioContext|null>(null)
  const particlesRef = useRef<HTMLDivElement[]>([])

  const s = passos[cur]

  function playClick(freq=700, dur=0.06) {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      const ctx = audioCtxRef.current
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.value = freq; o.type = 'sine'
      g.gain.setValueAtTime(0.08, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
      o.start(); o.stop(ctx.currentTime + dur)
    } catch {}
  }

  function playSuccess() {
    [523,659,784,1047].forEach((f,i) => setTimeout(() => playClick(f, 0.12), i*90))
  }

  function haptic() {
    try { navigator.vibrate && navigator.vibrate([8,4,8]) } catch {}
  }

  function getPos(id: string) {
    const container = containerRef.current
    const el = document.getElementById(id)
    if (!el || !container) return null
    const cr = container.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    return { top: er.top - cr.top, left: er.left - cr.left, w: er.width, h: er.height }
  }

  function typeText(text: string) {
    if (typeRef.current) clearTimeout(typeRef.current)
    setIsMouthing(true)
    let i = 0
    if (typingRef.current) typingRef.current.textContent = ''
    function next() {
      if (i <= text.length) {
        if (typingRef.current) typingRef.current.textContent = text.slice(0, i)
        i++
        typeRef.current = setTimeout(next, 22)
      } else {
        setIsMouthing(false)
      }
    }
    setTimeout(next, 150)
  }

  function clearParticles() {
    particlesRef.current.forEach(p => p.remove())
    particlesRef.current = []
  }

  function spawnParticles(cx: number, cy: number, color: string) {
    clearParticles()
    const container = containerRef.current
    if (!container) return
    const anims = ['orbit0','orbit1','orbit2','orbit3']
    const sizes = [5,4,6,3]
    const speeds = [2.8,2.0,3.5,2.2]
    anims.forEach((anim, i) => {
      const p = document.createElement('div')
      p.style.cssText = `position:absolute;border-radius:50%;width:${sizes[i]}px;height:${sizes[i]}px;background:${color};top:${cy}px;left:${cx}px;z-index:203;pointer-events:none;animation:${anim} ${speeds[i]}s linear infinite;opacity:0.9;box-shadow:0 0 5px ${color};`
      container.appendChild(p)
      particlesRef.current.push(p)
    })
  }

  function confete() {
    const container = containerRef.current
    if (!container) return
    const cols = ['#ff6b00','#ffd700','#4ade80','#60a5fa','#ec4899','#f87171','#fff']
    for (let i = 0; i < 50; i++) {
      const c = document.createElement('div')
      const sz = 4 + Math.random() * 8
      c.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;background:${cols[i%cols.length]};left:${Math.random()*280}px;top:0;border-radius:${Math.random()>.5?'50%':'2px'};z-index:300;pointer-events:none;animation:confeteFall ${0.6+Math.random()*1.4}s ease ${Math.random()*0.7}s forwards;`
      container.appendChild(c)
      setTimeout(() => c.remove(), 2500)
    }
  }

  useEffect(() => {
    const p = passos[cur]
    if (p.highlightId) {
      setTimeout(() => {
        const r = getPos(p.highlightId!)
        setSplRect(r)
        if (p.particles && r) spawnParticles(r.left + r.w/2 - 3, r.top + r.h/2 - 3, p.accent)
      }, 150)
    } else {
      setSplRect(null)
      clearParticles()
    }
    if (p.arrowId) {
      setTimeout(() => setArrowRect(getPos(p.arrowId!)), 150)
    } else setArrowRect(null)
    setTimeout(() => typeText(p.text), 200)
    playClick(360 + cur * 60, 0.07)
  }, [cur])

  useEffect(() => {
    setTimeout(() => typeText(passos[0].text), 300)
  }, [])

  useEffect(() => {
    return () => {
      clearParticles()
      if (typeRef.current) clearTimeout(typeRef.current)
      if (mouthRef.current) clearInterval(mouthRef.current)
    }
  }, [])

  const faceAnims: Record<string, string> = {
    '👨‍🍳': 'chefIdle 2s infinite',
    '🧐': 'chefIdle 2s infinite',
    '😄': 'chefIdle 2s infinite',
    '😮': 'chefWiggle 0.6s ease',
    '🥳': 'chefCelebrate 0.9s ease',
  }

  function advance() {
    haptic()
    playClick(360 + cur * 60, 0.07)
    if (dismissed) {
      try { localStorage.setItem(storageKey, '1') } catch {}
    }
    if (cur < passos.length - 1) {
      setCur(c => c + 1)
      if (cur === passos.length - 2) setTimeout(() => { confete(); playSuccess() }, 200)
    } else {
      clearParticles()
      onClose()
    }
  }

  const circumference = 2 * Math.PI * 14
  const dashOffset = circumference * (1 - (cur + 1) / passos.length)

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, zIndex: 999 }}>
      <style>{`
        @keyframes orbit0 { from{transform:rotate(0deg) translateX(24px) rotate(0deg);} to{transform:rotate(360deg) translateX(24px) rotate(-360deg);} }
        @keyframes orbit1 { from{transform:rotate(90deg) translateX(18px) rotate(-90deg);} to{transform:rotate(450deg) translateX(18px) rotate(-450deg);} }
        @keyframes orbit2 { from{transform:rotate(180deg) translateX(28px) rotate(-180deg);} to{transform:rotate(540deg) translateX(28px) rotate(-540deg);} }
        @keyframes orbit3 { from{transform:rotate(270deg) translateX(14px) rotate(-270deg);} to{transform:rotate(630deg) translateX(14px) rotate(-630deg);} }
        @keyframes chefIdle { 0%,100%{transform:translateY(0) rotate(0);} 50%{transform:translateY(-5px) rotate(2deg);} }
        @keyframes chefWiggle { 0%,100%{transform:rotate(0);} 25%{transform:rotate(-14deg);} 75%{transform:rotate(14deg);} }
        @keyframes chefCelebrate { 0%{transform:scale(1) rotate(0);} 20%{transform:scale(1.4) rotate(-15deg);} 45%{transform:scale(1.35) rotate(15deg);} 70%{transform:scale(1.1) rotate(-5deg);} 100%{transform:scale(1);} }
        @keyframes chefJump { 0%{transform:translateY(0) scale(1);} 25%{transform:translateY(-20px) scale(1.12) rotate(-6deg);} 60%{transform:translateY(-6px) rotate(3deg);} 100%{transform:translateY(0) scale(1);} }
        @keyframes bubIn { from{opacity:0;transform:translateY(6px);} to{opacity:1;transform:translateY(0);} }
        @keyframes arrowFloat { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-8px);} }
        @keyframes splGlow { 0%,100%{box-shadow:0 0 0 9999px rgba(0,0,0,0.87),0 0 0 0 transparent;} 50%{box-shadow:0 0 0 9999px rgba(0,0,0,0.87),0 0 0 10px transparent;} }
        @keyframes confeteFall { 0%{transform:translateY(-10px) rotate(0);opacity:1;} 100%{transform:translateY(100vh) rotate(720deg);opacity:0;} }
        @keyframes mouthTalk { 0%,100%{height:3px;} 50%{height:7px;} }
        @keyframes swipeHint { 0%{transform:translateX(-4px);opacity:0.5;} 50%{transform:translateX(10px);opacity:0.25;} 100%{transform:translateX(-4px);opacity:0.5;} }
        @keyframes pipExpand { from{flex:1;} to{flex:2.5;} }
      `}</style>

      {/* Dim */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.87)', transition: 'background 0.4s' }} />

      {/* Spotlight */}
      {splRect && (
        <div style={{ position: 'absolute', top: splRect.top - 5, left: splRect.left - 5, width: splRect.w + 10, height: splRect.h + 10, borderRadius: 14, border: `2px solid ${s.accent}`, zIndex: 201, pointerEvents: 'none', animation: 'splGlow 2s infinite', transition: 'all 0.5s cubic-bezier(0.34,1.56,0.64,1)' }} />
      )}

      {/* SVG connector */}
      {splRect && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 202, pointerEvents: 'none' }}>
          <line
            x1={splRect.left + splRect.w / 2} y1={splRect.top + splRect.h + 5}
            x2={60} y2={typeof window !== 'undefined' ? window.innerHeight - 180 : 400}
            stroke={s.accent} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.4}
          />
        </svg>
      )}

      {/* Arrow */}
      {arrowRect && (
        <div style={{ position: 'absolute', top: arrowRect.top - 36, left: arrowRect.left + arrowRect.w/2 - 12, fontSize: 24, zIndex: 202, pointerEvents: 'none', animation: 'arrowFloat 0.9s ease-in-out infinite', filter: 'drop-shadow(0 4px 12px rgba(255,107,0,0.8))' }}>👇</div>
      )}

      {/* Circular progress */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 216 }}>
        <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
          <circle cx="18" cy="18" r="14" fill="none" stroke={s.accent} strokeWidth={3} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.34,1.56,0.64,1), stroke 0.4s' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: s.accent }}>{cur+1}/{passos.length}</div>
      </div>

      {/* Bottom panel */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 220, padding: '0 14px 16px' }}>

        {/* Gradient fade */}
        <div style={{ position: 'absolute', top: -60, left: 0, right: 0, height: 60, background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.95))', pointerEvents: 'none' }} />

        {/* Step pips */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {passos.map((_, idx) => (
            <div key={idx} style={{ height: 4, borderRadius: 2, flex: idx === cur ? 2.5 : 1, background: idx < cur ? 'rgba(255,255,255,0.25)' : idx === cur ? s.accent : 'rgba(255,255,255,0.08)', transition: 'all 0.4s cubic-bezier(0.34,1.56,0.64,1)' }} />
          ))}
        </div>

        {/* Swipe hint */}
        {cur === 0 && (
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '3px 10px', animation: 'swipeHint 1.6s ease-in-out infinite' }}>
              <span style={{ fontSize: 13 }}>👉</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 600 }}>Deslize para avancar</span>
            </div>
          </div>
        )}

        {/* Mascote + balao */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 10 }}>
          {/* Chef */}
          <div style={{ position: 'relative', width: 52, height: 54, flexShrink: 0 }}>
            <div style={{ fontSize: 48, position: 'absolute', bottom: 0, filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.8))', animation: faceAnims[s.face] || 'chefIdle 2s infinite' }}>{s.face}</div>
            {/* Mouth dots */}
            <div style={{ position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 1.5 }}>
              {[0,1,2,3,4].map(i => (
                <div key={i} style={{ width: 3, borderRadius: '50%', background: 'rgba(0,0,0,0.4)', transition: 'height 0.08s', height: isMouthing ? (i===2?8:i===1||i===3?6:4) : 3 }} />
              ))}
            </div>
          </div>

          {/* Balao */}
          <div style={{ flex: 1 }}>
            <div style={{ background: '#fff', borderRadius: '4px 16px 16px 16px', padding: '11px 13px 10px', position: 'relative', boxShadow: '0 8px 28px rgba(0,0,0,0.6)' }}>
              {/* Triangle */}
              <div style={{ position: 'absolute', left: -8, bottom: 12, width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderRight: `9px solid #fff` }} />
              {/* Accent bar */}
              <div style={{ height: 3, background: s.accent, borderRadius: '4px 16px 0 0', margin: '-11px -13px 8px', transition: 'background 0.3s' }} />
              {/* Tag */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 20, marginBottom: 5, background: s.tagBg, color: s.tagColor, transition: 'all 0.3s' }}>{s.tag}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#111', lineHeight: 1.2, marginBottom: 3 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: '#666', lineHeight: 1.45, minHeight: 48, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                <span ref={typingRef}></span>{isMouthing && <span style={{ display: 'inline-block', width: 2, height: 11, background: '#ccc', marginLeft: 1, verticalAlign: 'middle', animation: 'arrowFloat 0.7s step-end infinite' }} />}
              </div>
            </div>
          </div>
        </div>

        {/* Botoes */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { clearParticles(); onClose() }} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.3)', borderRadius: 12, padding: '10px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Pular</button>
          <button onClick={advance} style={{ flex: 1, border: 'none', borderRadius: 12, padding: '11px', fontSize: 13, fontWeight: 800, cursor: 'pointer', color: '#fff', background: s.nextBg, boxShadow: `0 4px 20px ${s.accent}50`, transition: 'all 0.2s' }}>{s.nextLabel}</button>
        </div>

        {s.showDismiss && (
          <div onClick={() => setDismissed(!dismissed)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, cursor: 'pointer' }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${dismissed ? s.accent : 'rgba(255,255,255,0.15)'}`, background: dismissed ? s.accent : 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
              {dismissed && <span style={{ color: '#fff', fontSize: 10, fontWeight: 800 }}>✓</span>}
            </div>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10.5 }}>Nao mostrar mais esse tutorial</span>
          </div>
        )}
      </div>
    </div>
  )
}