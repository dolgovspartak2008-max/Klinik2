/*
 * Плеер уроков (/kursy/<slug>/uroki/?l=<id урока>).
 *
 * Защита (насколько это возможно в браузере):
 *   • видео лежит в приватном хранилище; ссылку выдаёт сервер только после проверки права на урок,
 *     ссылка живёт 10 минут, при истечении плеер тихо запрашивает новую;
 *   • одна активная сессия просмотра на аккаунт: «пульс» раз в 25 секунд, при входе с другого
 *     устройства этот просмотр останавливается;
 *   • поверх видео — полупрозрачный водяной знак с номером клиента, он перемещается;
 *   • нет кнопки скачивания, контекстного меню и «картинки в картинке».
 * Полностью защитить видео от записи экрана в браузере невозможно — об этом сказано в README.
 */
(function () {
  "use strict";
  var doc = document;
  var SB = window.SB, C = window.FZC;
  if (!SB || !C) return;
  window.FZAuthStay = true;
  var esc = C.esc;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function state(n) { $$("[data-state]").forEach(function (s) { s.hidden = s.getAttribute("data-state") !== n; }); }
  function toast(m) { if (window.FZToast) window.FZToast(m); }

  var slug = (location.pathname.match(/^\/kursy\/([a-z0-9-]+)/) || [])[1] || "";
  var data = null, lesson = null, session = null, beat = null, saveTimer = null, wmTimer = null, idleTimer = null;
  var retries = 0, lastSaved = 0, pendingSeek = null;

  var box = $("[data-ply]"), video = $("video", box), veil = $("[data-veil]", box), wm = $("[data-wm]", box);
  var spin = $("[data-spin]", box);

  // постоянный идентификатор устройства (для правила «одна сессия»)
  function deviceId() {
    var k = "fz.dev", v = null;
    try { v = localStorage.getItem(k); } catch (e) {}
    if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
      var a = new Uint8Array(18); crypto.getRandomValues(a);
      v = Array.prototype.map.call(a, function (b) { return "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 57]; }).join("");
      try { localStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }
  var DEVICE = deviceId();

  // ------------------------------------------------------------ экран-заглушка поверх видео
  function showVeil(html, actions) {
    veil.classList.remove("is-start");
    veil.innerHTML = html;
    (actions || []).forEach(function (a) {
      var b = doc.createElement(a.href ? "a" : "button");
      b.className = "btn " + (a.cls || "btn--light");
      if (a.href) b.href = a.href; else b.type = "button";
      b.textContent = a.text;
      if (a.onClick) b.addEventListener("click", a.onClick);
      veil.appendChild(b);
    });
    veil.hidden = false;
  }
  function hideVeil() { veil.hidden = true; veil.innerHTML = ""; veil.classList.remove("is-start"); }
  function bigPlay() {
    showVeil('<button class="ply-big" type="button" aria-label="Смотреть урок"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg></button><span class="ply-veil__cap">Смотреть урок</span>');
    veil.classList.add("is-start");
    $(".ply-big", veil).addEventListener("click", function () { start(false); });
  }

  // ------------------------------------------------------------ водяной знак
  function moveWm() {
    var x = 4 + Math.random() * 56, y = 6 + Math.random() * 70;
    wm.style.left = x + "%"; wm.style.top = y + "%";
  }

  // ------------------------------------------------------------ загрузка урока
  function stopTimers() { clearInterval(beat); clearInterval(saveTimer); beat = saveTimer = null; }

  // Ссылку на видео запрашиваем заранее, пока человек читает описание урока:
  // браузер успевает подгрузить начало ролика, и по кнопке «Смотреть» видео стартует сразу.
  var prepared = null;
  function prepare(l) {
    prepared = null;
    if (!l || !l.can_watch) return;
    var item = { id: l.id, at: Date.now(), p: SB.courses("play", { lesson_id: l.id, device_id: DEVICE, force: false }) };
    prepared = item;
    item.p.then(function (r) {
      if (prepared !== item || lesson !== l || video.getAttribute("src")) return;
      session = r.session_id;
      video.preload = "auto";
      video.src = r.url;
      startBeat();
    }).catch(function () { if (prepared === item) prepared = null; });
  }

  function start(force) {
    if (!lesson) return;
    if (!lesson.can_watch) return locked();
    hideVeil();
    box.classList.remove("is-off");
    spin.hidden = false;
    var pos = pendingSeek != null ? pendingSeek : (!lesson.completed && lesson.position_sec && lesson.duration_sec && lesson.position_sec < lesson.duration_sec - 5 ? Number(lesson.position_sec) : 0);
    pendingSeek = null;
    // заранее полученная ссылка годится, если ей меньше 8 минут (живёт 10)
    var ready = !force && prepared && prepared.id === lesson.id && Date.now() - prepared.at < 480000 ? prepared.p : null;
    prepared = null;
    var req = ready || SB.courses("play", { lesson_id: lesson.id, device_id: DEVICE, force: !!force });
    return req.then(function (r) {
      session = r.session_id;
      retries = 0;
      if (video.getAttribute("src") !== r.url) { video.preload = "auto"; video.src = r.url; }
      function go() {
        if (pos > 0 && pos < video.duration - 1) video.currentTime = pos;
        var p = video.play();
        if (p && p.catch) p.catch(function () { spin.hidden = true; bigPlayResume(); });
      }
      if (video.readyState >= 1) go();
      else video.addEventListener("loadedmetadata", function once() { video.removeEventListener("loadedmetadata", once); go(); });
      startBeat();
    }).catch(function (e) {
      spin.hidden = true;
      if (e.code === "other_device") {
        var since = e.data && e.data.since ? new Date(e.data.since).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
        showVeil("<b>Курс открыт на другом устройстве</b><p>Смотреть одновременно можно только на одном устройстве" +
          (since ? " (там просмотр начат в " + since + ")" : "") + ". Продолжить здесь? На другом устройстве видео остановится.</p>",
          [{ text: "Смотреть здесь", cls: "btn--light", onClick: function () { start(true); } }]);
      } else if (e.code === "not_authenticated") {
        showVeil("<b>Войдите, чтобы смотреть</b>", [{ text: "Войти", onClick: function () { window.FZAuth && window.FZAuth.open("login"); } }]);
      } else if (e.code === "no_access") {
        locked();
      } else {
        showVeil("<b>Не удалось загрузить видео</b><p>" + esc(e.message) + "</p>", [{ text: "Попробовать снова", onClick: function () { start(false); } }]);
      }
    });
  }
  function bigPlayResume() {
    showVeil('<button class="ply-big" type="button" aria-label="Продолжить"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg></button>');
    $(".ply-big", veil).addEventListener("click", function () { hideVeil(); video.play(); });
  }

  function locked() {
    stopTimers();
    video.removeAttribute("src"); video.load();
    var c = data.course;
    showVeil("<b>Урок доступен после покупки</b><p>Купите курс «" + esc(c.title) + "», чтобы смотреть все уроки.</p>",
      c.on_sale ? [{ text: "Купить за " + C.money(c.price), href: "/kursy/" + encodeURIComponent(slug) + "/", cls: "btn--light" }] : []);
  }

  // ------------------------------------------------------------ пульс сессии и прогресс
  function startBeat() {
    stopTimers();
    beat = setInterval(function () {
      if (!session || doc.hidden) return;
      SB.rpc("course_heartbeat", { p_session: session }).then(function (r) {
        if (r && r.ok === false) ended(r.reason);
      }).catch(function () {});
    }, 25000);
    saveTimer = setInterval(function () { if (!video.paused) save(false); }, 15000);
  }

  function ended(reason) {
    stopTimers();
    save(false);
    video.pause();
    video.removeAttribute("src"); video.load();
    session = null;
    var text = reason === "replaced" ? "Курс открыли на другом устройстве — здесь просмотр остановлен."
      : reason === "revoked" || reason === "admin" ? "Доступ к просмотру приостановлен. Если это ошибка — позвоните в клинику."
      : "Сеанс просмотра завершён.";
    showVeil("<b>Просмотр остановлен</b><p>" + text + "</p>",
      reason === "revoked" || reason === "admin" ? [] : [{ text: "Смотреть здесь", onClick: function () { pendingSeek = video.currentTime || null; start(true); } }]);
  }

  function save(done) {
    if (!lesson || !lesson.can_watch) return Promise.resolve();
    var pos = video.currentTime || 0;
    if (!done && Math.abs(pos - lastSaved) < 2) return Promise.resolve();
    lastSaved = pos;
    return SB.rpc("course_progress_save", { p_lesson: lesson.id, p_position: Math.round(pos * 10) / 10,
      p_duration: isFinite(video.duration) ? Math.round(video.duration) : null, p_completed: !!done })
      .then(function (r) {
        lesson.position_sec = pos;
        if (r && r.completed && !lesson.completed) { lesson.completed = true; renderList(); }
        if (r && r.progress) { data.progress = r.progress; renderTotal(); }
      }).catch(function () {});
  }

  // при закрытии вкладки — сохранить позицию и освободить сессию
  function leave() {
    if (!session) return;
    SB.token().then(function (t) {
      if (!t) return;
      var h = { "Content-Type": "application/json", Authorization: "Bearer " + t };
      var pos = video.currentTime || 0;
      if (lesson && lesson.can_watch && pos > 0) {
        fetch(SB.base + "/rpc", { method: "POST", keepalive: true, headers: h,
          body: JSON.stringify({ fn: "course_progress_save", args: { p_lesson: lesson.id, p_position: pos, p_duration: null, p_completed: false } }) }).catch(function () {});
      }
      fetch(SB.base + "/rpc", { method: "POST", keepalive: true, headers: h,
        body: JSON.stringify({ fn: "course_session_stop", args: { p_session: session } }) }).catch(function () {});
    });
  }
  window.addEventListener("pagehide", leave);

  // ------------------------------------------------------------ события видео
  video.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  box.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  video.addEventListener("waiting", function () { spin.hidden = false; });
  video.addEventListener("playing", function () { spin.hidden = true; hideVeil(); sync(); });
  video.addEventListener("canplay", function () { spin.hidden = true; });
  video.addEventListener("pause", function () { sync(); save(false); });
  video.addEventListener("play", sync);
  video.addEventListener("timeupdate", progressUi);
  video.addEventListener("progress", progressUi);
  video.addEventListener("ended", function () {
    save(true).then(function () {
      var next = nextLesson();
      if (next) {
        showVeil("<b>Урок пройден ✓</b><p>Следующий: «" + esc(next.title) + "»</p>",
          [{ text: "Следующий урок", onClick: function () { select(next.id, true); } },
           { text: "Посмотреть ещё раз", cls: "btn--glass", onClick: function () { hideVeil(); video.currentTime = 0; video.play(); } }]);
      } else {
        showVeil("<b>Курс пройден ✓</b><p>Вы посмотрели все уроки. Повторяйте комплексы регулярно — так от них больше пользы.</p>",
          [{ text: "Посмотреть ещё раз", onClick: function () { hideVeil(); video.currentTime = 0; video.play(); } }]);
      }
    });
  });
  // ссылка истекла или сеть пропала — запрашиваем новую ссылку и продолжаем с того же места
  video.addEventListener("error", function () {
    if (!video.getAttribute("src") || !lesson) return;
    if (box.classList.contains("is-off")) { video.removeAttribute("src"); video.load(); return; }
    if (retries++ >= 2) { showVeil("<b>Не удалось воспроизвести видео</b><p>Проверьте интернет и попробуйте ещё раз.</p>",
      [{ text: "Повторить", onClick: function () { retries = 0; pendingSeek = video.currentTime || null; start(false); } }]); return; }
    pendingSeek = video.currentTime || null;
    start(false);
  });

  // ------------------------------------------------------------ свои элементы управления
  var playBtn = $("[data-play]", box), muteBtn = $("[data-mute]", box), vol = $("[data-vol]", box), fsBtn = $("[data-fs]", box);
  var rateBtn = $("[data-rate]", box), seek = $("[data-seek]", box), fill = $("[data-fill]", box), buf = $("[data-buf]", box), time = $("[data-time]", box);
  var ICON_PLAY = '<svg viewBox="0 0 24 24"><path class="is-fill" d="M7 4v16l13-8z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect class="is-fill" x="6" y="4" width="4" height="16" rx="1"/><rect class="is-fill" x="14" y="4" width="4" height="16" rx="1"/></svg>';

  function sync() {
    playBtn.innerHTML = video.paused ? ICON_PLAY : ICON_PAUSE;
    playBtn.setAttribute("aria-label", video.paused ? "Смотреть" : "Пауза");
    muteBtn.setAttribute("aria-label", video.muted ? "Включить звук" : "Выключить звук");
    muteBtn.innerHTML = video.muted || video.volume === 0
      ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 4 6M21 9l-4 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
  }
  function progressUi() {
    var d = video.duration || (lesson && lesson.duration_sec) || 0;
    var t = video.currentTime || 0;
    fill.style.width = d ? Math.min(100, t / d * 100) + "%" : "0";
    if (video.buffered.length && d) buf.style.width = Math.min(100, video.buffered.end(video.buffered.length - 1) / d * 100) + "%";
    time.textContent = C.clock(t) + " / " + C.clock(d);
  }
  function toggle() {
    if (box.classList.contains("is-off") || !video.getAttribute("src")) return start(false);
    if (video.paused) video.play(); else video.pause();
  }
  playBtn.addEventListener("click", toggle);

  // ±10 секунд: кнопки на панели и двойное касание по левой/правой части видео (как в YouTube)
  var flash = doc.createElement("span");
  flash.className = "ply-jump"; flash.hidden = true; box.appendChild(flash);
  var flashTimer = null;
  function jump(sec) {
    if (box.classList.contains("is-off")) return;
    var d = video.duration || 0;
    video.currentTime = Math.max(0, Math.min(d ? d - 0.2 : Infinity, (video.currentTime || 0) + sec));
    flash.textContent = (sec < 0 ? "‹‹ " : "") + Math.abs(sec) + " сек" + (sec > 0 ? " ››" : "");
    flash.className = "ply-jump " + (sec < 0 ? "is-left" : "is-right");
    flash.hidden = false;
    clearTimeout(flashTimer); flashTimer = setTimeout(function () { flash.hidden = true; }, 650);
    progressUi(); wake();
  }
  $("[data-back]", box).addEventListener("click", function () { jump(-10); });
  $("[data-fwd]", box).addEventListener("click", function () { jump(10); });
  var tapTimer = null;
  video.addEventListener("click", function (e) {
    if (box.classList.contains("is-off")) return toggle();
    if (tapTimer) { // второе касание — перемотка
      clearTimeout(tapTimer); tapTimer = null;
      var r = video.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x < 0.4) jump(-10); else if (x > 0.6) jump(10); else toggle();
      return;
    }
    tapTimer = setTimeout(function () { tapTimer = null; toggle(); }, 260);
  });
  muteBtn.addEventListener("click", function () { video.muted = !video.muted; sync(); });
  vol.addEventListener("input", function () { video.volume = Number(vol.value); video.muted = video.volume === 0; sync(); });
  var RATES = [1, 1.25, 1.5, 0.75];
  rateBtn.addEventListener("click", function () {
    var i = (RATES.indexOf(video.playbackRate) + 1) % RATES.length;
    video.playbackRate = RATES[i]; rateBtn.textContent = String(RATES[i]).replace(".", ",") + "×";
  });
  function seekTo(e) {
    var r = seek.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    var d = video.duration || 0;
    if (d) { video.currentTime = Math.max(0, Math.min(1, x / r.width)) * d; progressUi(); }
  }
  var dragging = false;
  seek.addEventListener("pointerdown", function (e) { dragging = true; seek.setPointerCapture(e.pointerId); seekTo(e); });
  seek.addEventListener("pointermove", function (e) { if (dragging) seekTo(e); });
  seek.addEventListener("pointerup", function () { dragging = false; save(false); });
  seek.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { jump(5); e.preventDefault(); }
    if (e.key === "ArrowLeft") { jump(-5); e.preventDefault(); }
  });

  // Во весь экран разворачиваем контейнер (а не само видео), чтобы водяной знак оставался поверх.
  // На iPhone полноэкранный режим для элементов недоступен — используем растягивание на весь экран.
  function isFs() { return doc.fullscreenElement === box || doc.webkitFullscreenElement === box || box.classList.contains("is-pseudo-fs"); }
  fsBtn.addEventListener("click", function () {
    if (isFs()) {
      if (box.classList.contains("is-pseudo-fs")) { box.classList.remove("is-pseudo-fs"); doc.body.classList.remove("has-modal"); }
      else (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      return;
    }
    var req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) {
      var p = req.call(box);
      if (p && p.catch) p.catch(function () { box.classList.add("is-pseudo-fs"); doc.body.classList.add("has-modal"); });
    } else { box.classList.add("is-pseudo-fs"); doc.body.classList.add("has-modal"); }
  });
  doc.addEventListener("keydown", function (e) {
    if (e.target.closest("input, textarea, select, button")) return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
    if (e.key === "Escape" && box.classList.contains("is-pseudo-fs")) { box.classList.remove("is-pseudo-fs"); doc.body.classList.remove("has-modal"); }
    if (e.key === "ArrowRight") jump(5);
    if (e.key === "ArrowLeft") jump(-5);
  });
  // прятать панель, когда видео идёт и мышь не двигается
  function wake() {
    box.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (!video.paused) box.classList.add("is-idle"); }, 2600);
  }
  box.addEventListener("pointermove", wake);
  box.addEventListener("touchstart", wake, { passive: true });
  video.addEventListener("play", wake);

  // ------------------------------------------------------------ список уроков
  function nextLesson() {
    var ls = data.lessons, i = ls.indexOf(lesson);
    for (var j = i + 1; j < ls.length; j++) if (ls[j].can_watch) return ls[j];
    return null;
  }
  function renderTotal() {
    var p = data.progress || {};
    var total = p.total || data.lessons.length, done = p.completed || 0;
    $("[data-total]").innerHTML = data.access
      ? '<span class="lrn-head__count">Пройдено <b>' + done + "</b> из " + C.plural(total, "урока", "уроков", "уроков") + "</span>" +
        '<div class="crs-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (p.percent || 0) + '"><i style="width:' + (p.percent || 0) + '%"></i></div>'
      : "";
  }

  // уроки, сгруппированные по модулям (порядок — как в курсе)
  function groups() {
    var out = [], byName = {};
    data.lessons.forEach(function (l) {
      var name = l.module || "";
      if (!byName[name]) { byName[name] = { name: name, lessons: [] }; out.push(byName[name]); }
      byName[name].lessons.push(l);
    });
    return out;
  }
  var ICON_DONE = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
  var ICON_NOW = '<svg viewBox="0 0 24 24"><path class="is-fill" d="M8 5v14l11-7z"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function renderList() {
    var gs = groups(), single = gs.length === 1 && !gs[0].name;
    $("[data-list]").innerHTML = gs.map(function (g) {
      var done = g.lessons.filter(function (l) { return l.completed; }).length;
      var has = lesson && g.lessons.indexOf(lesson) >= 0;
      return '<section class="lrn-module' + (has ? " is-current" : "") + (done === g.lessons.length ? " is-done" : "") + '">' +
        '<header class="lrn-module__head"><h3>' + esc(single ? "Уроки" : g.name || "Другие уроки") + "</h3>" +
        "<small>" + (data.access && done === g.lessons.length ? "✓ пройдено" : data.access && done ? "пройдено " + done + " из " + g.lessons.length : C.plural(g.lessons.length, "урок", "урока", "уроков")) + "</small></header>" +
        '<ul class="lrn-module__list">' + g.lessons.map(function (l) {
          var cur = lesson && lesson.id === l.id;
          var icon = !l.can_watch ? ICON_LOCK : cur ? ICON_NOW : l.completed ? ICON_DONE : "";
          var note = !l.can_watch ? "после покупки" : l.completed ? "пройден" : l.is_free && !data.access ? "бесплатно" : "";
          return '<li><button type="button" class="lrn-item' + (l.completed ? " is-done" : "") + (l.can_watch ? "" : " is-locked") + '" data-lesson="' + esc(l.id) + '"' +
            (cur ? ' aria-current="true"' : "") + '><span class="lrn-item__ico" aria-hidden="true">' + icon + "</span>" +
            '<span class="lrn-item__text"><b>' + esc(l.title) + "</b>" +
            (l.duration_sec || note ? "<small>" + [l.duration_sec ? C.dur(l.duration_sec) : "", note].filter(Boolean).join(" · ") + "</small>" : "") +
            "</span></button></li>";
        }).join("") + "</ul></section>";
    }).join("");
    renderTotal();
  }

  // «Что понадобится»: каждая строка (или через запятую) — отдельный предмет
  function kitItems(t) {
    var lines = String(t || "").split(/\n/).map(function (x) { return x.trim().replace(/^[-•–*]\s*/, ""); }).filter(Boolean);
    if (lines.length === 1 && lines[0].indexOf(",") > 0) lines = lines[0].split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    return lines;
  }

  function prevLesson() {
    var ls = data.lessons, i = ls.indexOf(lesson);
    for (var j = i - 1; j >= 0; j--) if (ls[j].can_watch) return ls[j];
    return null;
  }

  function renderInfo() {
    var i = data.lessons.indexOf(lesson);
    $("[data-where]").textContent = (lesson.module ? lesson.module + " · " : "") + "урок " + (i + 1) + " из " + data.lessons.length;
    $("[data-title]").textContent = lesson.title;
    $("[data-meta]").innerHTML = [lesson.duration_sec ? "Длительность " + C.dur(lesson.duration_sec) : "",
      lesson.completed ? '<span class="lrn-tag">✓ Пройден</span>' : ""].filter(Boolean).join(" ");

    var desc = String(lesson.description || "").trim(), kit = kitItems(lesson.equipment), rec = String(lesson.recommendations || "").trim();
    $("[data-desc-block]").hidden = !desc;
    $("[data-desc]").innerHTML = C.richText(desc);
    $("[data-kit-block]").hidden = !kit.length;
    $("[data-kit]").innerHTML = kit.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    $("[data-rec]").hidden = !rec;
    $("[data-rec-text]").innerHTML = C.richText(rec);
    $("[data-info-empty]").hidden = !!(desc || kit.length || rec);

    var next = nextLesson(), prev = prevLesson();
    var nb = $("[data-next]"), pb = $("[data-prev]");
    nb.hidden = !next; pb.hidden = !prev;
    if (next) nb.onclick = function () { select(next.id, true); };
    if (prev) pb.onclick = function () { select(prev.id, true); };
    var done = $("[data-done]");
    done.hidden = !lesson.can_watch || lesson.completed;
    done.onclick = function () { save(true).then(function () { lesson.completed = true; toast("Урок отмечен как пройденный"); renderList(); renderInfo(); }); };
    var ask = $("[data-ask]"), wa = window.SITE_CONTACTS && window.SITE_CONTACTS.whatsapp;
    ask.hidden = !wa;
    if (wa) ask.href = wa + (wa.indexOf("?") >= 0 ? "&" : "?") + "text=" + encodeURIComponent(
      "Здравствуйте! У меня вопрос по онлайн-курсу «" + data.course.title + "», урок «" + lesson.title + "»: ");
    doc.title = lesson.title + " — " + data.course.title;
  }

  function select(id, autoplay) {
    var l = data.lessons.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    if (lesson && lesson !== l) save(false);
    lesson = l;
    lastSaved = Number(l.position_sec) || 0;
    try { history.replaceState(null, "", "?l=" + encodeURIComponent(l.id)); } catch (e) {}
    video.pause();
    video.removeAttribute("src"); video.load();
    box.classList.add("is-off");
    video.poster = l.poster_url || "";
    progressUi(); sync();
    renderList(); renderInfo();
    if (!l.can_watch) return locked();
    prepared = null;
    if (autoplay) start(false); else { bigPlay(); prepare(l); }
    if (autoplay) {
      var top = $("[data-main]").getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.4) $("[data-main]").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  $("[data-list]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-lesson]");
    if (b) select(b.getAttribute("data-lesson"), true);
  });

  // ------------------------------------------------------------ старт
  function load() {
    if (!SB.isSignedIn()) { state("guest"); return; }
    SB.rpc("course_player", { p_slug: slug }).then(function (d) {
      data = d;
      $("[data-course-link]").href = "/kursy/" + encodeURIComponent(slug) + "/";
      $("[data-crumb]").textContent = d.course.title;
      $("[data-course-title]").textContent = d.course.title;
      wm.textContent = d.watermark || "";
      moveWm(); wmTimer = setInterval(moveWm, 17000);
      $("[data-contra]").innerHTML = C.richText(d.course.contraindications);
      $("[data-contra-block]").hidden = !d.course.contraindications;
      if (d.blocked) $("[data-blocked]").hidden = false;
      if (!d.lessons.length) { state("empty"); return; }
      state("ready");
      var want = new URLSearchParams(location.search).get("l");
      var pick = d.lessons.filter(function (l) { return l.id === want; })[0] ||
        d.lessons.filter(function (l) { return l.id === (d.progress && d.progress.last_lesson_id) && !l.completed; })[0] ||
        d.lessons.filter(function (l) { return l.can_watch && !l.completed; })[0] ||
        d.lessons.filter(function (l) { return l.can_watch; })[0] || d.lessons[0];
      select(pick.id, false);
      if (!d.access && !d.lessons.some(function (l) { return l.can_watch; })) $("[data-buy-hint]").hidden = false;
    }).catch(function (e) {
      if (e.code === "not_authenticated") { state("guest"); return; }
      $("[data-error-text]").textContent = e.code === "not_found" ? "Курс не найден или снят с продажи." : e.message;
      state("error");
    });
  }
  load();
})();
