/*
 * Онлайн-курсы: каталог (/kursy/), страница курса (/kursy/<slug>/) и окно покупки.
 * Цена, скидка и выдача доступа считаются только на сервере (public.course_quote / course_order_create);
 * здесь — только отображение.
 */
(function () {
  "use strict";
  var doc = document;
  var SB = window.SB;
  window.FZAuthStay = true; // после входа остаёмся на этой странице

  // ------------------------------------------------------------ общие помощники (нужны и плееру, и кабинету)
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { return n == null ? "—" : Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽"; }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return n + " " + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); }
  function dur(sec) {
    sec = Math.round(Number(sec) || 0);
    if (sec < 60) return sec + " сек";
    var m = Math.round(sec / 60);
    if (m < 60) return m + " мин";
    return Math.floor(m / 60) + " ч " + (m % 60 ? (m % 60) + " мин" : "");
  }
  function clock(sec) { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  // Текст из админки: строки «- …» — список, пустая строка — новый абзац
  function richText(t) {
    var out = "", list = [];
    function flush() { if (list.length) { out += "<ul>" + list.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; list = []; } }
    String(t || "").split(/\n/).forEach(function (line) {
      var l = line.trim();
      if (/^[-•–]\s+/.test(l)) { list.push(l.replace(/^[-•–]\s+/, "")); return; }
      flush();
      if (l) out += "<p>" + esc(l) + "</p>";
    });
    flush();
    return out;
  }
  function cover(c, cls) {
    if (c.cover_url) return '<div class="crs-cover ' + (cls || "") + '"><img src="' + esc(c.cover_url) + '" alt="" loading="lazy" decoding="async" /></div>';
    return '<div class="crs-cover crs-cover--empty ' + (cls || "") + '"><img src="/assets/logo-ga.svg" alt="" /><span>' + esc(c.title) + "</span></div>";
  }
  var ICO = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>',
    time: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.5"/></svg>'
  };
  function meta(stats) {
    stats = stats || {};
    return '<div class="crs-meta"><span>' + ICO.play + plural(stats.lessons || 0, "видеоурок", "видеоурока", "видеоуроков") + "</span>" +
      "</div>";
  }
  function priceHtml(price, old) {
    return '<div class="crs-price"><b>' + money(price) + "</b>" + (old && old > price ? "<s>" + money(old) + "</s>" : "") + "</div>";
  }
  function toast(m) { if (window.FZToast) window.FZToast(m); }
  function key() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  // группы уроков по модулям в порядке первого появления
  function modules(list) {
    var out = [], idx = {};
    (list || []).forEach(function (l) {
      var k = (l.module || "").trim();
      if (!(k in idx)) { idx[k] = out.length; out.push({ name: k, items: [] }); }
      out[idx[k]].items.push(l);
    });
    return out;
  }
  window.FZC = { modules: modules, esc: esc, money: money, plural: plural, dur: dur, clock: clock, richText: richText, cover: cover, meta: meta, priceHtml: priceHtml, ICO: ICO };

  // меню-«бургер» в шапке на телефоне
  (function () {
    var btn = doc.querySelector("[data-crs-burger]");
    if (!btn) return;
    var header = btn.closest(".header");
    function set(open) { btn.setAttribute("aria-expanded", String(open)); header.classList.toggle("crs-menu-open", open); }
    btn.addEventListener("click", function () { set(btn.getAttribute("aria-expanded") !== "true"); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
    doc.addEventListener("click", function (e) { if (!header.contains(e.target)) set(false); });
  })();

  var page = doc.body.getAttribute("data-page");
  if (!SB || !SB.enabled) return;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function state(name) { $$("[data-state]").forEach(function (s) { s.hidden = s.getAttribute("data-state") !== name; }); }
  function requireLogin() { if (window.FZAuth) window.FZAuth.open("login"); }

  // ------------------------------------------------------------ окно покупки
  var buy = $("#buyModal");
  var buyCtx = null; // { type, id, title, gift }
  var quote = null;

  function buyView(v) { $$("[data-buy-view]", buy).forEach(function (x) { x.hidden = x.getAttribute("data-buy-view") !== v; }); }
  function buyStatus(t, ok) { var s = $("[data-buy-status]", buy); s.textContent = t || ""; s.className = "acc-status" + (t ? ok ? " is-ok" : " is-error" : ""); }

  function renderQuote(q) {
    quote = q;
    var rows = '<div><dt>' + esc(q.title) + (q.is_gift ? " (в подарок)" : "") + "</dt><dd>" + money(q.list_price) + "</dd></div>";
    if (Number(q.base_price) !== Number(q.list_price)) rows += '<div class="is-disc"><dt>С учётом уже купленных курсов</dt><dd>' + money(q.base_price) + "</dd></div>";
    if (Number(q.discount) > 0) rows += '<div class="is-disc"><dt>Промокод ' + esc(q.promo_code) + "</dt><dd>−" + money(q.discount) + "</dd></div>";
    rows += '<div class="is-total"><dt>К оплате</dt><dd>' + money(q.total) + "</dd></div>";
    $("[data-buy-lines]", buy).innerHTML = rows;
    var note = $("[data-buy-note]", buy);
    note.hidden = !q.note;
    note.textContent = q.note || "";
    $("[data-buy-submit]", buy).textContent = Number(q.total) === 0 ? "Получить доступ" : "Оформить заказ";
  }

  function loadQuote(promo) {
    var btn = $("[data-buy-submit]", buy);
    btn.disabled = true;
    return SB.rpc("course_quote", { p_item_type: buyCtx.type, p_item_id: buyCtx.id, p_promo: promo || null, p_gift: buyCtx.gift })
      .then(function (q) { renderQuote(q); btn.disabled = false; return q; });
  }

  function openBuy(ctx) {
    if (!SB.isSignedIn()) { requireLogin(); return; }
    buyCtx = ctx; quote = null;
    var f = $("[data-buy-form]", buy);
    f.reset();
    f.elements.gift.checked = !!ctx.gift;
    $("#buyTitle").textContent = ctx.title;
    buyStatus("");
    $("[data-buy-lines]", buy).innerHTML = '<div class="crs-skel" style="height:64px"></div>';
    buyView("form");
    buy.hidden = false; doc.body.classList.add("has-modal");
    loadQuote(null).catch(function (e) {
      buyStatus(e.message, false);
      if (e.code === "already_owned") buyStatus("Этот курс уже есть в вашем кабинете.", true);
    });
    setTimeout(function () { var x = $("[data-buy-close]", buy); if (x) x.focus(); }, 50);
  }
  function closeBuy() { if (!buy) return; buy.hidden = true; doc.body.classList.remove("has-modal"); }
  window.FZBuy = openBuy;

  if (buy) {
    buy.addEventListener("click", function (e) { if (e.target.closest("[data-buy-close]")) closeBuy(); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !buy.hidden) closeBuy(); });
    var form = $("[data-buy-form]", buy);
    form.elements.gift.addEventListener("change", function () {
      buyCtx.gift = form.elements.gift.checked;
      buyStatus("");
      loadQuote(form.elements.promo.value.trim()).catch(function (e) { buyStatus(e.message, false); });
    });
    $("[data-buy-apply]", buy).addEventListener("click", function () {
      var code = form.elements.promo.value.trim();
      if (!code) { buyStatus("Введите промокод.", false); return; }
      loadQuote(code).then(function () { buyStatus("Промокод применён.", true); })
        .catch(function (e) { buyStatus(e.message, false); loadQuote(null).catch(function () {}); form.elements.promo.value = ""; });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!quote) return;
      if (!form.elements.terms.checked) { buyStatus("Подтвердите согласие с условиями покупки.", false); return; }
      if (!form.elements.health.checked) { buyStatus("Подтвердите, что ознакомились с противопоказаниями.", false); return; }
      var btn = $("[data-buy-submit]", buy);
      btn.disabled = true; btn.classList.add("is-busy");
      var k = form.dataset.key || (form.dataset.key = key());
      SB.rpc("course_order_create", { p_item_type: buyCtx.type, p_item_id: buyCtx.id, p_promo: quote.promo_code || null,
        p_gift: buyCtx.gift, p_key: k })
        .then(function (r) { delete form.dataset.key; showDone(r.order); })
        .catch(function (err) { buyStatus(err.message, false); delete form.dataset.key; })
        .then(function () { btn.disabled = false; btn.classList.remove("is-busy"); });
    });
  }

  function showDone(o) {
    buyView("done");
    var C = window.SITE_CONTACTS || {};
    var paid = o.status === "paid";
    $("[data-done-title]", buy).textContent = paid ? (o.is_gift ? "Подарок оформлен" : "Доступ открыт") : "Заказ оформлен";
    $("[data-done-no]", buy).textContent = "Заказ № " + o.order_no + " · " + money(o.total);
    var text = paid
      ? (o.is_gift ? "Подарочный код — в разделе «Мои курсы» в личном кабинете. Передайте его получателю." : "Курс уже в разделе «Мои курсы». Можно начинать заниматься.")
      : "Онлайн-оплата на сайте скоро появится. Сейчас администратор клиники свяжется с вами и подскажет, как оплатить. Чтобы ускорить, напишите нам — номер заказа уже в сообщении. Доступ откроется автоматически, как только оплата будет подтверждена.";
    $("[data-done-text]", buy).textContent = text;
    var msg = "Здравствуйте! Хочу оплатить заказ № " + o.order_no + " — «" + o.title + "» на сайте, " + money(o.total) + ".";
    var act = $("[data-done-actions]", buy);
    act.innerHTML = "";
    if (paid) {
      var go = doc.createElement("a");
      go.className = "btn btn--primary";
      go.href = !o.is_gift && o.course_slug ? "/kursy/" + o.course_slug + "/uroki/" : "/kabinet/#courses";
      go.textContent = !o.is_gift && o.course_slug ? "Перейти к обучению" : "Мои курсы";
      act.appendChild(go);
    } else {
      if (C.whatsapp) {
        var wa = doc.createElement("a");
        wa.className = "btn btn--accent"; wa.target = "_blank"; wa.rel = "noopener";
        wa.href = C.whatsapp + (C.whatsapp.indexOf("?") >= 0 ? "&" : "?") + "text=" + encodeURIComponent(msg);
        wa.textContent = "Написать в WhatsApp";
        act.appendChild(wa);
      }
      if (C.telegram) {
        var tg = doc.createElement("a");
        tg.className = "btn btn--tg"; tg.target = "_blank"; tg.rel = "noopener"; tg.href = C.telegram;
        tg.textContent = "Telegram";
        act.appendChild(tg);
      }
      var my = doc.createElement("a");
      my.className = "btn btn--outline"; my.href = "/kabinet/#courses"; my.textContent = "Мои заказы";
      act.appendChild(my);
    }
  }

  // ------------------------------------------------------------ каталог
  // короткие подписи модулей для тегов на карточке
  var MOD_SHORT = { "тазобедренный": "Таз", "тазобедренные суставы": "Таз", "тазобедренный сустав": "Таз" };
  function modTag(m) { return MOD_SHORT[String(m).trim().toLowerCase()] || m; }

  function card(c) {
    var href = "/kursy/" + encodeURIComponent(c.slug) + "/";
    var act = c.owned
      ? '<a class="btn btn--primary crs-card__btn" href="' + href + 'uroki/">Перейти к обучению</a>'
      : c.price != null
        ? '<button class="btn btn--primary crs-card__btn" type="button" data-buy-id="' + esc(c.id) + '" data-title="' + esc(c.title) + '">Купить курс</button>'
        : '<a class="btn btn--primary crs-card__btn" href="' + href + '">Подробнее</a>';
    var n = (c.stats && c.stats.lessons) || 0;
    var mods = (c.modules || []).filter(Boolean);
    return '<article class="crs-card" data-cat="' + esc(c.category && c.category.slug) + '">' +
      '<div class="crs-card__media">' + cover(c) +
        (c.owned ? '<span class="crs-badge crs-badge--owned">Куплено</span>' : c.old_price ? '<span class="crs-badge">Скидка</span>' : "") + "</div>" +
      '<div class="crs-card__body">' +
        (c.direction ? '<p class="crs-card__dir">' + esc(c.direction) + "</p>" : "") +
        '<h3><a href="' + href + '">' + esc(c.title) + "</a></h3>" +
        (c.short ? '<p class="crs-card__short">' + esc(c.short) + "</p>" : "") +
        '<p class="crs-card__count">' + ICO.play + plural(n, "видеоролик", "видеоролика", "видеороликов") +
          "</p>" +
        (mods.length ? '<ul class="crs-tags" aria-label="Модули курса">' + mods.map(function (m) { return "<li>" + esc(modTag(m)) + "</li>"; }).join("") + "</ul>" : "") +
        '<div class="crs-card__foot">' + (c.owned ? '<span class="crs-card__note">Курс уже в вашем кабинете</span>' : priceHtml(c.price, c.old_price)) + act + "</div>" +
      "</div></article>";
  }

  function bundleHtml(b) {
    var owned = b.courses.filter(function (x) { return x.owned; }).length;
    var all = owned === b.courses.length;
    var save = b.courses_price && b.price < b.courses_price ? "Выгода " + money(b.courses_price - b.price) + " по сравнению с покупкой по отдельности" : "";
    return '<article class="crs-bundle"><div>' +
      '<p class="crs-card__dir">Комплект · ' + plural(b.courses.length, "курс", "курса", "курсов") + "</p>" +
      "<h3>" + esc(b.title) + "</h3><p>" + esc(b.description) + "</p>" +
      "<ul>" + b.courses.map(function (c) { return '<li class="' + (c.owned ? "is-owned" : "") + '"><a href="/kursy/' + esc(c.slug) + '/">' + esc(c.title) + "</a></li>"; }).join("") + "</ul></div>" +
      '<div class="crs-bundle__buy">' + priceHtml(b.price, b.old_price || b.courses_price) +
        (save ? '<p class="crs-bundle__save">' + esc(save) + "</p>" : "") +
        (all ? '<p class="crs-buy__owned">Все курсы комплекта уже у вас</p>' :
          '<button class="btn btn--accent" type="button" data-buy-bundle="' + esc(b.id) + '" data-title="' + esc("Комплект «" + b.title + "»") + '">' +
            (owned ? "Докупить комплект" : "Купить комплект") + "</button>") +
        '<button class="acc-link" type="button" data-gift-bundle="' + esc(b.id) + '" data-title="' + esc("Комплект «" + b.title + "»") + '">Купить в подарок</button>' +
      "</div></article>";
  }

  function catalog() {
    SB.rpc("courses_catalog").then(function (d) {
      var cats = d.categories || [];
      var list = $("[data-courses]");
      var tabs = $("[data-cats]");
      if (!d.courses.length) {
        list.innerHTML = '<div class="crs-empty"><b>Курсы скоро появятся</b>Мы готовим видеозанятия. Загляните позже или запишитесь на приём в клинику.</div>';
      } else {
        list.innerHTML = '<div class="crs-list">' + d.courses.map(card).join("") + "</div>";
      }
      tabs.innerHTML = cats.length > 1 ? '<button class="crs-cat" type="button" role="tab" data-cat-btn="" aria-selected="true">Все курсы</button>' +
        cats.map(function (k) { return '<button class="crs-cat" type="button" role="tab" data-cat-btn="' + esc(k.slug) + '" aria-selected="false">' + esc(k.title) + "</button>"; }).join("") : "";
      tabs.hidden = cats.length < 2;
      var catDesc = $("[data-cat-desc]");
      function pick(slug) {
        $$("[data-cat-btn]").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-cat-btn") === slug)); });
        $$(".crs-card", list).forEach(function (c) { c.hidden = !!slug && c.getAttribute("data-cat") !== slug; });
        var k = cats.filter(function (x) { return x.slug === slug; })[0];
        catDesc.textContent = k ? k.description : "Выберите направление или посмотрите все курсы.";
        try { history.replaceState(null, "", slug ? "#" + slug : location.pathname); } catch (e) {}
      }
      tabs.addEventListener("click", function (e) { var b = e.target.closest("[data-cat-btn]"); if (b) pick(b.getAttribute("data-cat-btn")); });
      var h = decodeURIComponent(location.hash.slice(1));
      pick(cats.some(function (k) { return k.slug === h; }) ? h : "");

      var bl = $("[data-bundles]");
      bl.hidden = !d.bundles.length;
      $("[data-bundle-list]").innerHTML = d.bundles.map(bundleHtml).join("");
      state("ready");
    }).catch(function (e) {
      $("[data-error-text]").textContent = e.message;
      state("error");
    });
  }

  doc.addEventListener("click", function (e) {
    var bc = e.target.closest("[data-buy-id]");
    if (bc) { e.preventDefault(); openBuy({ type: "course", id: bc.getAttribute("data-buy-id"), title: bc.getAttribute("data-title"), gift: false }); return; }
    var b = e.target.closest("[data-buy-bundle],[data-gift-bundle]");
    if (b) openBuy({ type: "bundle", id: b.getAttribute("data-buy-bundle") || b.getAttribute("data-gift-bundle"),
      title: b.getAttribute("data-title"), gift: b.hasAttribute("data-gift-bundle") });
    var r = e.target.closest("[data-reload]");
    if (r) location.reload();
    var a = e.target.closest("[data-open-auth]");
    if (a && window.FZAuth) window.FZAuth.open(a.getAttribute("data-open-auth") || "login");
  });

  // ------------------------------------------------------------ страница курса
  function slugFromPath() {
    var m = location.pathname.match(/^\/kursy\/([a-z0-9-]+)/);
    return m ? m[1] : (new URLSearchParams(location.search).get("c") || "");
  }

  function infoCard(title, text) {
    if (!String(text || "").trim()) return "";
    return '<section class="crs-info__card"><h2>' + title + '</h2><div class="crs-text">' + richText(text) + "</div></section>";
  }

  function coursePage() {
    var slug = slugFromPath();
    SB.rpc("course_detail", { p_slug: slug }).then(function (c) {
      var learn = "/kursy/" + encodeURIComponent(c.slug) + "/uroki/";
      doc.title = c.title + " — онлайн-курс — Кабинет здоровья доктора Горшечникова";
      var md = doc.querySelector('meta[name="description"]');
      if (md && c.short) md.setAttribute("content", c.short);
      $("[data-crumb]").textContent = c.title;

      var mods = modules(c.lessons).map(function (g) { return g.name; }).filter(Boolean);
      var free = c.lessons.some(function (l) { return l.is_free; });
      var facts = (mods.length ? '<p class="crs-card__count">' + ICO.play + plural(mods.length, "модуль", "модуля", "модулей") + "</p>" +
        '<ul class="crs-tags" aria-label="Модули курса">' + mods.map(function (m) { return "<li>" + esc(modTag(m)) + "</li>"; }).join("") + "</ul>" : "");

      var buyBox;
      if (c.owned) {
        var p = c.progress || {};
        buyBox = '<div class="crs-buybox">' +
          '<div class="crs-buybox__row"><span class="crs-card__note">Курс уже в вашем кабинете · пройдено ' + (p.percent || 0) + "%</span>" +
          '<a class="btn btn--primary crs-card__btn" href="' + learn + '">' + (p.completed ? "Продолжить обучение" : "Перейти к обучению") + "</a></div></div>";
      } else if (!c.on_sale) {
        buyBox = '<p class="buy-note buy-note--warn">Курс сейчас не продаётся.</p>';
      } else {
        buyBox = '<div class="crs-buybox">' +
          '<div class="crs-buybox__row">' + priceHtml(c.price, c.old_price) +
            '<button class="btn btn--primary crs-card__btn" type="button" data-buy-course>Купить курс</button></div>' +
          '<p class="crs-buybox__small">' + (c.access_days ? "Доступ на " + plural(c.access_days, "день", "дня", "дней") : "Доступ навсегда") +
            " · телефон или компьютер · " + '<a href="/kursy/usloviya/">условия покупки</a>' +
            (free ? ' · <a href="' + learn + '">бесплатный урок</a>' : "") + "</p></div>";
      }

      var warn = c.contraindications || c.results;
      $("[data-main]").innerHTML =
        '<section class="crs-card crs-card--page">' +
          '<div class="crs-card__media">' + cover(c) + (c.owned ? '<span class="crs-badge crs-badge--owned">Куплено</span>' : "") + "</div>" +
          '<div class="crs-card__body">' +
            (c.direction ? '<p class="crs-card__dir">' + esc(c.direction) + "</p>" : "") +
            "<h1>" + esc(c.title) + "</h1>" +
            (c.short ? '<p class="crs-card__short">' + esc(c.short) + "</p>" : "") + facts + buyBox +
          "</div></section>" +
        '<div class="crs-info">' +
          infoCard("Для кого", c.for_whom) +
          infoCard("Чем поможет", c.tasks) +
          infoCard("Как заниматься", c.recommendations) +
        "</div>" +
        (warn ? '<section class="crs-note crs-note--block">' + ICO.warn + "<div><b>Противопоказания</b>" +
          (c.contraindications ? '<div class="crs-text">' + richText(c.contraindications) + "</div>" : "") +
          (c.results ? "<p>" + esc(c.results) + " Курс не заменяет консультацию врача.</p>" : "") + "</div></section>" : "");

      var bar = $("[data-mbar]");
      if (!c.owned && c.on_sale) {
        bar.innerHTML = priceHtml(c.price, c.old_price) + '<button class="btn btn--primary" type="button" data-buy-course>Купить курс</button>';
      } else if (c.owned) {
        bar.innerHTML = '<span class="crs-meta">Курс у вас</span><a class="btn btn--primary" href="' + learn + '">К урокам</a>';
      }
      // нижняя панель — только когда кнопка в карточке ушла за экран
      var box = $(".crs-buybox");
      if (bar.innerHTML && box && "IntersectionObserver" in window) {
        new IntersectionObserver(function (en) { bar.classList.toggle("is-hidden", en[0].isIntersecting || en[0].boundingClientRect.top > 0); })
          .observe(box);
      }
      doc.addEventListener("click", function (e) {
        if (e.target.closest("[data-buy-course]")) openBuy({ type: "course", id: c.id, title: c.title, gift: false });
        if (e.target.closest("[data-buy-gift]")) openBuy({ type: "course", id: c.id, title: c.title, gift: true });
      });
      state("ready");
    }).catch(function (e) {
      if (e.code === "not_found") { $("[data-error-title]").textContent = "Курс не найден"; $("[data-error-text]").textContent = "Возможно, он снят с продажи. Посмотрите другие курсы."; }
      else $("[data-error-text]").textContent = e.message;
      state("error");
    });
  }

  if (page === "catalog") catalog();
  if (page === "course") coursePage();
})();
