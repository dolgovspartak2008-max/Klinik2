(() => {
  'use strict';

  const body = document.body;
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktopMQ = window.matchMedia('(min-width: 981px)');

  /* ---------- Intro ---------- */
  const intro = document.getElementById('intro');
  let introFinished = false;
  const finishIntro = () => {
    if (introFinished) return;
    introFinished = true;
    intro.classList.add('is-out');
    body.classList.remove('is-loading');
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

  /* ---------- Header + floating button ---------- */
  const header = document.getElementById('header');
  const fab = document.querySelector('.fab');
  const contacts = document.getElementById('contacts');
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    const nearForm = contacts.getBoundingClientRect().top < window.innerHeight * 0.9;
    fab.classList.toggle('is-visible', y > window.innerHeight * 0.8 && !nearForm);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  const menu = document.getElementById('mmenu');
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
  desktopMQ.addEventListener('change', (e) => { if (e.matches && !menu.hidden) setMenu(false); });

  /* ---------- Reveal on scroll ---------- */
  const reveals = document.querySelectorAll('.reveal');
  document.querySelectorAll('.team-grid, .faq__list').forEach((grid) => {
    [...grid.children].forEach((el, i) => el.style.setProperty('--d', `${(i % 4) * 0.08}s`));
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
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

  /* ---------- Hero photo parallax ---------- */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (!reduceMotion && parallaxEls.length) {
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      if (y < window.innerHeight * 1.2) {
        parallaxEls.forEach((el) => { el.style.transform = `translateY(${y * parseFloat(el.dataset.parallax)}px)`; });
      }
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
  }

  /* ---------- Booking form helpers ---------- */
  const form = document.getElementById('booking-form');
  const serviceSelect = form.elements.service;
  const setService = (name) => {
    if ([...serviceSelect.options].some((o) => o.value === name)) serviceSelect.value = name;
  };
  document.querySelectorAll('[data-service-set]').forEach((el) => {
    el.addEventListener('click', () => setService(el.dataset.serviceSet));
  });

  /* ---------- Procedures ---------- */
  const procs = [...document.querySelectorAll('.proc')];
  const stageImgs = [...document.querySelectorAll('.proc-stage__frame img')];
  const counter = document.getElementById('proc-current');
  const pad = (n) => String(n).padStart(2, '0');

  const activateProc = (proc) => {
    procs.forEach((p) => p.classList.toggle('is-active', p === proc));
    stageImgs.forEach((img) => img.classList.toggle('is-active', img.dataset.key === proc.dataset.key));
    counter.textContent = pad(procs.indexOf(proc) + 1);
  };
  activateProc(procs[0]);

  procs.forEach((proc) => {
    proc.addEventListener('mouseenter', () => { if (desktopMQ.matches) activateProc(proc); });
    proc.addEventListener('focusin', () => { if (desktopMQ.matches) activateProc(proc); });
    proc.addEventListener('click', (e) => {
      if (e.target.closest('.proc__btn')) return;
      if (desktopMQ.matches) activateProc(proc);
    });
    proc.querySelector('.proc__btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openSheet(proc, e.currentTarget);
    });
  });

  // точки-индикатор для мобильной карусели
  const list = document.getElementById('proc-list');
  const dotsWrap = document.querySelector('.procs-dots');
  procs.forEach(() => dotsWrap.appendChild(document.createElement('i')));
  const dots = [...dotsWrap.children];
  const updateDots = () => {
    const step = procs[1] ? procs[1].offsetLeft - procs[0].offsetLeft : 1;
    const idx = Math.min(procs.length - 1, Math.max(0, Math.round(list.scrollLeft / step)));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
  };
  list.addEventListener('scroll', () => requestAnimationFrame(updateDots), { passive: true });
  updateDots();

  /* ---------- Procedure details sheet ---------- */
  const sheet = document.getElementById('proc-sheet');
  const sheetImg = document.getElementById('sheet-img');
  const sheetTitle = document.getElementById('sheet-title');
  const sheetPrice = document.getElementById('sheet-price');
  const sheetContent = document.getElementById('sheet-content');
  const sheetBook = document.getElementById('sheet-book');
  let sheetOpener = null;
  let currentService = '';

  const openSheet = (proc, opener) => {
    sheetOpener = opener;
    const img = proc.querySelector('.proc__img img');
    sheetImg.src = img.getAttribute('src');
    sheetImg.alt = img.alt;
    sheetImg.style.objectPosition = img.classList.contains('pos-top') ? 'center 30%' : '';
    sheetTitle.textContent = proc.querySelector('.proc__name').textContent;
    sheetPrice.textContent = proc.querySelector('.proc__price').textContent;
    sheetContent.replaceChildren(proc.querySelector('.proc__details').content.cloneNode(true));
    currentService = proc.dataset.service;
    sheet.querySelector('.sheet__inner').scrollTop = 0;
    sheet.querySelector('.sheet__body').scrollTop = 0;
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
    root.classList.add('is-locked');
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-shown')));
  };
  const closeSheet = (after) => {
    sheet.classList.remove('is-shown');
    setTimeout(() => {
      if (sheet.open) sheet.close();
      root.classList.remove('is-locked');
      if (after) after(); else if (sheetOpener) sheetOpener.focus({ preventScroll: true });
    }, reduceMotion ? 0 : 380);
  };
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-sheet-close]')) closeSheet();
  });
  sheetBook.addEventListener('click', (e) => {
    e.preventDefault();
    setService(currentService);
    closeSheet(() => {
      document.getElementById('booking').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      setTimeout(() => form.elements.name.focus({ preventScroll: true }), 700);
    });
  });

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
        activate(tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length], true);
      }
    });
  });
  const initInk = () => moveInk(tabs.find((t) => t.classList.contains('is-active')));
  initInk();
  window.addEventListener('resize', initInk);
  if (document.fonts) document.fonts.ready.then(initInk);

  /* ---------- Booking form ---------- */
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
