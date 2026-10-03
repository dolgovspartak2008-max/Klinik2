(() => {
  'use strict';

  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Intro ---------- */
  const intro = document.getElementById('intro');
  let introFinished = false;

  const finishIntro = () => {
    if (introFinished) return;
    introFinished = true;
    intro.classList.add('is-out');
    body.classList.remove('is-loading');
    // небольшой отступ, чтобы hero начинал анимацию вместе с раскрытием шторок
    setTimeout(() => body.classList.add('is-ready'), 250);
    setTimeout(() => intro.classList.add('is-done'), 1500);
  };

  if (reduceMotion) {
    intro.classList.add('is-done');
    body.classList.remove('is-loading');
    body.classList.add('is-ready');
    introFinished = true;
  } else {
    requestAnimationFrame(() => intro.classList.add('is-run'));
    const minTime = new Promise((r) => setTimeout(r, 2100));
    const loaded = new Promise((r) => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true })));
    const maxTime = new Promise((r) => setTimeout(r, 4500));
    Promise.race([Promise.all([minTime, loaded]), maxTime]).then(finishIntro);
    intro.addEventListener('click', finishIntro);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') finishIntro(); }, { once: true });
  }

  /* ---------- Header state ---------- */
  const header = document.getElementById('header');
  const fab = document.querySelector('.fab');
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    fab.classList.toggle('is-visible', y > window.innerHeight * 0.8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu (отдельный полноэкранный слой) ---------- */
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  const menu = document.getElementById('mmenu');
  const root = document.documentElement;
  let menuTimer;
  const setMenu = (open) => {
    clearTimeout(menuTimer);
    burger.setAttribute('aria-expanded', String(open));
    if (open) {
      menu.hidden = false;
      root.classList.add('is-locked');
      requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
      menu.querySelector('.mmenu__close').focus({ preventScroll: true });
    } else {
      menu.classList.remove('is-open');
      root.classList.remove('is-locked');
      menuTimer = setTimeout(() => { menu.hidden = true; }, reduceMotion ? 0 : 700);
      burger.focus({ preventScroll: true });
    }
  };
  burger.addEventListener('click', () => setMenu(true));
  menu.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => setMenu(false)));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });
  window.matchMedia('(min-width: 981px)').addEventListener('change', (e) => { if (e.matches && !menu.hidden) setMenu(false); });

  /* ---------- Reveal on scroll ---------- */
  const reveals = document.querySelectorAll('.reveal');
  // лёгкая «лесенка» для элементов в одной сетке
  document.querySelectorAll('.dir-grid, .team-grid, .faq__list, .principles').forEach((grid) => {
    [...grid.children].forEach((el, i) => el.style.setProperty('--d', `${(i % 4) * 0.08}s`));
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- Active nav link ---------- */
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const navIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${entry.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => navIO.observe(s));
  }

  /* ---------- Parallax on hero photo ---------- */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (!reduceMotion && parallaxEls.length) {
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      parallaxEls.forEach((el) => {
        if (y < window.innerHeight * 1.2) {
          el.style.transform = `translateY(${y * parseFloat(el.dataset.parallax)}px)`;
        }
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
  }

  /* ---------- Magnetic buttons ---------- */
  if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.magnetic').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.18;
        const y = (e.clientY - r.top - r.height / 2) * 0.3;
        btn.style.transform = `translate(${x}px, ${y}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- Tabs ---------- */
  const tabs = [...document.querySelectorAll('.tab')];
  const ink = document.querySelector('.tabs__ink');
  const moveInk = (tab) => {
    ink.style.width = `${tab.offsetWidth}px`;
    ink.style.transform = `translateX(${tab.offsetLeft}px)`;
  };
  const activate = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      panel.hidden = !on;
      panel.classList.toggle('is-active', on);
    });
    moveInk(tab);
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        activate(next, true);
      }
    });
  });
  const initInk = () => moveInk(tabs.find((t) => t.classList.contains('is-active')));
  initInk();
  window.addEventListener('resize', initInk);
  document.fonts && document.fonts.ready.then(initInk);

  /* ---------- Booking form ---------- */
  const form = document.getElementById('booking-form');
  const serviceSelect = form.elements.service;

  // кнопки «Записаться на комплекс» подставляют услугу в форму
  document.querySelectorAll('[data-service]').forEach((btn) => {
    btn.addEventListener('click', () => { serviceSelect.value = btn.dataset.service; });
  });

  const phoneInput = form.elements.phone;
  phoneInput.addEventListener('input', () => {
    let d = phoneInput.value.replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (d && !d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    let out = d ? '+7' : '';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 4) out += ')';
    if (d.length > 4) out += ' ' + d.slice(4, 7);
    if (d.length > 7) out += '-' + d.slice(7, 9);
    if (d.length > 9) out += '-' + d.slice(9, 11);
    phoneInput.value = out;
  });

  const setError = (input, msg) => {
    const field = input.closest('.field');
    const err = field ? field.querySelector('.field__error') : form.querySelector('.field__error--consent');
    if (field) field.classList.toggle('is-invalid', Boolean(msg));
    if (err) err.textContent = msg || '';
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    const phoneDigits = phoneInput.value.replace(/\D/g, '');
    const consent = form.elements.consent.checked;
    let ok = true;

    if (name.length < 2) { setError(form.elements.name, 'Укажите имя'); ok = false; } else setError(form.elements.name, '');
    if (phoneDigits.length !== 11) { setError(phoneInput, 'Укажите номер полностью'); ok = false; } else setError(phoneInput, '');
    if (!consent) { setError(form.elements.consent, 'Нужно согласие на обработку данных'); ok = false; } else setError(form.elements.consent, '');
    if (!ok) { form.querySelector('.is-invalid input, .is-invalid textarea')?.focus(); return; }

    const comment = form.elements.comment.value.trim();
    const text = [
      'Здравствуйте! Хочу записаться на приём.',
      `Имя: ${name}`,
      `Телефон: ${phoneInput.value}`,
      `Услуга: ${serviceSelect.value}`,
      comment ? `Комментарий: ${comment}` : ''
    ].filter(Boolean).join('\n');

    window.open(`https://wa.me/79930440619?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  /* ---------- Year ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();

/* ---------- Процедуры: окно «Подробнее» ---------- */
(() => {
  'use strict';
  const INFO = {
    hijama: {
      lead: 'Традиционная методика баночного кровопускания: на коже делают небольшие поверхностные насечки и устанавливают вакуумные банки.',
      forWhat: ['Мышечное напряжение и боль в спине', 'В составе оздоровительных программ, например комплекса «Хиджама»'],
      how: 'Процедуру проводит специалист одноразовыми стерильными инструментами. Перед хиджамой обязательна консультация: у методики есть противопоказания, в том числе нарушения свёртываемости крови, анемия и приём препаратов, разжижающих кровь.',
      service: 'Хиджама'
    },
    massage: {
      lead: 'Классический массаж с элементами глубокого и фасциального массажа и проработкой триггерных точек.',
      forWhat: ['Общее мышечное напряжение и усталость', 'Боль в спине и шее от сидячей работы', 'Восстановление после физических нагрузок'],
      how: 'Массажист прорабатывает выбранную зону и уделяет особое внимание участкам напряжения. Продолжительность зависит от зоны: от 10 минут для лица до часа для всего тела.',
      service: 'Массаж'
    },
    uvt: {
      lead: 'Аппарат направляет акустические импульсы на болезненную зону. Они улучшают кровообращение и обменные процессы в тканях и помогают уменьшить боль.',
      forWhat: ['Пяточная шпора', 'Эпикондилит («локоть теннисиста»), тендиниты', 'Болезненные уплотнения и триггерные точки в мышцах', 'Боль в плече и колене'],
      how: 'Насадку аппарата прикладывают к коже через гель. Ощущаются ритмичные толчки, иногда это умеренно неприятно. Обычно назначают курс с перерывами в несколько дней между сеансами.',
      service: 'Ударно-волновая терапия'
    },
    vgt: {
      lead: 'Аппаратный вакуумный массаж банками. Дозированное разрежение усиливает крово- и лимфоток и расслабляет спазмированные мышцы.',
      forWhat: ['Спазм и напряжение мышц спины и шеи', 'Застойные явления и отёчность', 'Восстановление после физических нагрузок'],
      how: 'Банки устанавливают на кожу, аппарат создаёт переменное разрежение. После процедуры на коже могут остаться круглые следы, они проходят за несколько дней.',
      service: 'Вакуумно-градиентная терапия'
    },
    magnet: {
      lead: 'Сочетание двух методик. Импульсное магнитное поле проникает в глубокие ткани и вызывает сокращение мышц, а лазерное излучение уменьшает воспаление, отёк и боль.',
      forWhat: ['Боль в спине и шее, в том числе отдающая в руку или ногу', 'Боль в суставах, связках и сухожилиях', 'Мышечная слабость, восстановление после травм'],
      how: 'Вы лежите, индуктор располагают над нужной зоной: ощущаются ритмичные подёргивания мышц. Затем насадку лазера плавно ведут над проблемным участком, чувствуется приятное тепло. Обе процедуры безболезненны, на время лазера выдают защитные очки.',
      service: 'Магнитно-лазерная терапия'
    },
    iglo: {
      lead: 'Акупунктура: тонкие стерильные иглы вводят в определённые точки тела.',
      forWhat: ['Боль в спине и шее', 'Мышечное напряжение', 'Головная боль напряжения'],
      how: 'Используются только одноразовые иглы. В точке может ощущаться лёгкое покалывание или распирание. Пока иглы установлены, вы спокойно лежите и отдыхаете.',
      service: 'Иглоукалывание'
    },
    heel: {
      lead: 'Для лечения применяется ударно-волновая терапия: акустические импульсы воздействуют на болезненную зону пятки, улучшают кровообращение и обменные процессы в тканях.',
      forWhat: ['Пяточная шпора', 'Боль в пятке при ходьбе и нагрузке'],
      how: 'Насадку аппарата прикладывают к стопе через гель, ощущаются ритмичные толчки. Обычно назначают курс из нескольких сеансов с перерывами в несколько дней. Количество процедур определяет специалист.',
      service: 'Лечение пяточной шпоры'
    }
  };

  const modal = document.getElementById('proc-modal');
  if (!modal) return;
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const img = document.getElementById('pm-img');
  const title = document.getElementById('pm-title');
  const price = document.getElementById('pm-price');
  const content = document.getElementById('pm-content');
  const book = document.getElementById('pm-book');
  let opener = null, service = '', savedY = 0, hasState = false;

  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const open = (card, from) => {
    const d = INFO[card.dataset.proc];
    if (!d) return;
    opener = from;
    savedY = window.scrollY;
    service = d.service;
    const src = card.querySelector('.dir-card__img img');
    img.src = src.getAttribute('src');
    img.alt = src.alt;
    img.style.objectPosition = src.classList.contains('pos-top') ? 'center 30%' : '';
    title.textContent = card.querySelector('h3').textContent;
    price.textContent = card.querySelector('.dir-card__price').textContent;
    content.innerHTML = `<p class="lead">${esc(d.lead)}</p><h4>Кому подходит</h4><ul>${d.forWhat.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h4>Как проходит</h4><p>${esc(d.how)}</p>`;
    modal.querySelector('.proc-modal__body').scrollTop = 0;
    modal.querySelector('.proc-modal__card').scrollTop = 0;
    if (modal.showModal) modal.showModal(); else modal.setAttribute('open', '');
    root.classList.add('is-locked');
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-shown')));
    /* Жест/кнопка «назад» закрывает окно, а не уводит с сайта */
    try { history.pushState({ procModal: true }, ''); hasState = true; } catch (e) { hasState = false; }
  };
  const finish = (after) => {
    modal.classList.remove('is-shown');
    setTimeout(() => {
      if (modal.open) modal.close();
      root.classList.remove('is-locked');
      window.scrollTo({ top: savedY, behavior: 'instant' }); /* возвращаемся ровно туда, откуда открыли */
      if (after) after(); else if (opener) opener.focus({ preventScroll: true });
    }, reduce ? 0 : 350);
  };
  let pendingAfter = null;
  const close = (after) => {
    if (!modal.open) return;
    if (hasState) { pendingAfter = after || null; hasState = false; history.back(); }
    else finish(after);
  };
  window.addEventListener('popstate', () => {
    if (!modal.open) return;
    hasState = false;
    const a = pendingAfter; pendingAfter = null;
    finish(a);
  });

  document.querySelectorAll('.dir-card[data-proc]').forEach((card) => {
    const btn = card.querySelector('.dir-card__more');
    btn.addEventListener('click', (e) => { e.stopPropagation(); open(card, btn); });
    card.addEventListener('click', () => open(card, btn));
  });
  modal.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-pm-close]')) close(); });
  book.addEventListener('click', (e) => {
    e.preventDefault();
    const sel = document.querySelector('#booking-form select[name="service"]');
    if (sel && [...sel.options].some((o) => o.value === service)) sel.value = service;
    close(() => document.getElementById('booking').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }));
  });
})();
