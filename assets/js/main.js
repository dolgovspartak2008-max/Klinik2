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
