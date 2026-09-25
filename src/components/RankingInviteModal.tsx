"use client"

import { ChevronRight, Gift } from "lucide-react"

type RankingInviteModalProps = {
  onParticipar: () => void
  onDepois: () => void
  eyebrow?: string
  description?: string
}

/** Convite de ranking usado depois de uma ação de alto interesse (ex.: pedido). */
export default function RankingInviteModal({
  onParticipar,
  onDepois,
  eyebrow = "PEDIDO CONCLUÍDO",
  description = "Você já está juntando estrelas. Quer ver seu nome no placar e acompanhar suas chances de ganhar?",
}: RankingInviteModalProps) {
  return (
    <div className="cf-post-order-invite-backdrop" role="presentation">
      <section className="cf-post-order-invite" role="dialog" aria-modal="true" aria-labelledby="post-order-invite-title">
        <div className="cf-post-order-invite-visual" aria-hidden="true">
          <span className="invite-spark invite-spark-one">✦</span>
          <img className="invite-pizza" src="/assets/ranking/pizza-3d.webp" alt="" />
          <img className="invite-gift" src="/assets/ranking/presente-3d.webp" alt="" />
          <img className="invite-burger" src="/assets/ranking/hamburguer-3d.webp" alt="" />
          <img className="invite-soda" src="/assets/ranking/refrigerante-3d.webp" alt="" />
          <span className="invite-spark invite-spark-two">✦</span>
          <div className="invite-people"><i>👩🏻</i><i>🧑🏽</i><i>👨🏾</i><b>+8</b></div>
          <div className="invite-tour"><span>⭐ Acumule</span><i>→</i><span>📈 Suba</span><i>→</i><span>🎁 Ganhe</span></div>
          <h2 id="post-order-invite-title">Suas estrelas podem valer prêmios</h2>
        </div>
        <p className="invite-eyebrow"><Gift size={14} aria-hidden="true" /> {eyebrow}</p>
        <p className="invite-description">{description}</p>
        <div className="invite-privacy"><span aria-hidden="true">✓</span><strong>Primeiro nome + telefone mascarado</strong><small>você escolhe o que autorizar.</small></div>
        <button type="button" className="invite-primary" onClick={onParticipar}>Quero participar<ChevronRight size={18} aria-hidden="true" /></button>
        <button type="button" className="invite-secondary" onClick={onDepois}>Talvez depois</button>
        <small className="invite-footnote">Você pode mudar essa escolha depois.</small>
      </section>
      <style>{`
        .cf-post-order-invite-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(31,45,67,.58);backdrop-filter:blur(8px)}
        .cf-post-order-invite{width:min(420px,calc(100vw - 28px));max-height:min(820px,calc(100dvh - 28px));overflow:auto;padding:18px 22px 20px;border:1px solid rgba(255,255,255,.9);border-radius:28px;background:linear-gradient(145deg,rgba(255,253,248,.99),rgba(238,246,255,.99));box-shadow:0 28px 80px rgba(24,43,76,.34);text-align:center;animation:invite-in .35s ease-out}
        .cf-post-order-invite-visual{position:relative;min-height:264px;margin-bottom:18px;border:1px solid rgba(255,255,255,.9);border-radius:25px;background:radial-gradient(circle at 50% 44%,rgba(255,226,126,.25),transparent 58%),linear-gradient(145deg,#fffaf4,#f3f8ff);box-shadow:inset 0 1px 0 #fff,0 12px 28px rgba(62,84,119,.11);overflow:visible}
        .cf-post-order-invite-visual img{position:absolute;object-fit:contain;will-change:transform;filter:drop-shadow(0 15px 12px rgba(62,50,25,.24))}.invite-pizza{width:116px;height:116px;left:3%;top:30px;animation:invite-float 5s ease-in-out infinite}.invite-gift{width:134px;height:134px;left:33%;top:-54px;filter:drop-shadow(0 18px 14px rgba(173,112,19,.32))!important;animation:invite-gift 5.8s ease-in-out .2s infinite}.invite-burger{width:112px;height:112px;right:1%;top:27px;animation:invite-float 5.4s ease-in-out .35s infinite}.invite-soda{width:108px;height:108px;right:28%;top:106px;animation:invite-soda 5.5s ease-in-out .5s infinite}.invite-spark{position:absolute;color:#f4bd22;font-size:22px;text-shadow:0 0 10px rgba(246,185,25,.4);animation:invite-twinkle 1.8s ease-in-out infinite}.invite-spark-one{left:8%;top:76px}.invite-spark-two{right:31%;top:25px;font-size:15px}.invite-people{position:absolute;left:50%;transform:translateX(-50%);bottom:54px;display:flex;align-items:center;gap:3px;padding:5px 8px 5px 5px;border:1px solid #fff;border-radius:24px;background:rgba(255,255,255,.94);box-shadow:0 7px 18px rgba(47,67,98,.17);animation:invite-people 2.8s ease-in-out infinite}.invite-people i,.invite-people b{display:flex;width:31px;height:31px;align-items:center;justify-content:center;border:2px solid #fff;border-radius:50%;font-size:17px;font-style:normal;line-height:1}.invite-people i:nth-child(1){background:#f8d8d5}.invite-people i:nth-child(2){background:#f8e5bd;margin-left:-8px}.invite-people i:nth-child(3){background:#d6e7f7;margin-left:-8px}.invite-people b{margin-left:2px;background:#4f86ed;color:#fff;font-size:11px}.invite-tour{position:absolute;left:50%;bottom:17px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid rgba(255,255,255,.95);border-radius:18px;background:rgba(255,255,255,.75);box-shadow:0 4px 12px rgba(67,86,116,.08);white-space:nowrap;color:#53647a;font-size:9px;font-weight:700}.invite-tour i{font-style:normal;color:#9aa9bc}.cf-post-order-invite h2{position:absolute;left:0;right:0;bottom:-2px;margin:0;color:#172945;font-size:25px;line-height:1.08;letter-spacing:-.035em;font-weight:800}.invite-eyebrow{display:flex;align-items:center;justify-content:center;gap:5px;margin:0 0 8px;color:#4d78c5;font-size:10px;font-weight:800;letter-spacing:.08em}.invite-description{max-width:330px;margin:0 auto;color:#536781;font-size:14px;line-height:1.5}.invite-privacy{display:flex;align-items:center;justify-content:center;gap:6px;margin:15px auto 18px;padding-top:12px;border-top:1px solid rgba(176,196,226,.58);color:#61738b;font-size:11px}.invite-privacy>span{display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border:1px solid rgba(79,134,237,.24);border-radius:50%;background:#e9f1ff;color:#3972d7;font-weight:900}.invite-privacy strong{color:#304d77}.invite-privacy small{font-size:10.5px}.invite-primary,.invite-secondary{position:relative;width:100%;min-height:50px;border-radius:13px;font-size:15px;font-weight:700;cursor:pointer}.invite-primary{display:flex;align-items:center;justify-content:center;gap:8px;border:0;background:#4f86ed;color:#fff;box-shadow:0 8px 18px rgba(79,134,237,.22)}.invite-secondary{margin-top:10px;border:1px solid #cfd9e8;background:rgba(255,255,255,.75);color:#61738b;font-weight:500}.invite-footnote{display:block;margin-top:12px;color:#8190a4;font-size:10px}@keyframes invite-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@keyframes invite-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-8px) rotate(3deg) scale(1.04)}}@keyframes invite-gift{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-8px) rotate(-5deg) scale(1.05)}}@keyframes invite-soda{0%,100%{transform:translateY(9px) rotate(-3deg)}50%{transform:translateY(-3px) rotate(4deg) scale(1.04)}}@keyframes invite-people{0%,100%{transform:translateX(-50%)}50%{transform:translateX(-50%) translateY(-5px)}}@keyframes invite-twinkle{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:1;transform:scale(1.15)}}@media(prefers-reduced-motion:reduce){.cf-post-order-invite,.invite-pizza,.invite-gift,.invite-burger,.invite-soda,.invite-people,.invite-spark{animation:none}}
      `}</style>
    </div>
  )
}
