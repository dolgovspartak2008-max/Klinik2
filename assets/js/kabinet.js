/* Личный кабинет (сайт Горшечникова): онлайн-курсы и профиль. Скидки и приглашения Физиотеры здесь не показываются. */
(function () {
  "use strict";
  var doc = document;
  var SB = window.SB;
  var F = window.FZFormat || {};
  var esc = F.esc;
  var main = doc.getElementById("main");
  var data = null;

  function $(s, root) { return (root || doc).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(s)); }
  function toast(m) { if (window.FZToast) window.FZToast(m); }

  function state(name) {
    $$("[data-state]").forEach(function (s) { s.hidden = s.getAttribute("data-state") !== name; });
    main.setAttribute("aria-busy", String(name === "loading"));
    $$("[data-signout]").forEach(function (b) { b.hidden = !(SB && SB.isSignedIn()); });
  }


  function date(iso, withTime) {
    if (!iso) return "";
    var o = { day: "numeric", month: "long", year: "numeric" };
    if (withTime) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return new Date(iso).toLocaleString("ru-RU", o);
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    return n + " " + (m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
  }

  // «С нами уже …»: считаем по календарным дням в часовом поясе посетителя
  function sinceText(iso) {
    var d0 = new Date(iso), now = new Date();
    var a = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.max(0, Math.round((b - a) / 864e5));
    if (days === 0) return "Вы с нами с сегодняшнего дня — добро пожаловать! Мы рады, что вы с нами.";
    var span;
    if (days < 31) span = plural(days, "день", "дня", "дней");
    else if (days < 365) span = plural(Math.floor(days / 30.44), "месяц", "месяца", "месяцев");
    else {
      var y = Math.floor(days / 365.25), m = Math.floor((days - y * 365.25) / 30.44);
      span = plural(y, "год", "года", "лет") + (m ? " и " + plural(m, "месяц", "месяца", "месяцев") : "");
    }
    return "Вы с нами уже " + span + " — мы очень рады, что вы с нами!";
  }

  function askName(p) {
    var f = $("[data-name-form]");
    var guess = p.name || (p.telegram && p.telegram.first_name) || "";
    if (!f.elements.name.value) f.elements.name.value = window.FZName && window.FZName.ok(guess) ? window.FZName.clean(guess) : "";
    state("name");
    setTimeout(function () { f.elements.name.focus(); }, 50);
  }

  // ------------------------------------------------------------ отрисовка
  function render(d) {
    data = d;
    var p = d.profile;

    $("[data-admin-link]").hidden = !p.is_admin;

    // имя обязательно: без подтверждённого имени (например, после входа через Telegram) кабинет не открываем
    if (!p.name_confirmed) { askName(p); return; }

    $("[data-hello]").textContent = "Здравствуйте, " + p.name.split(" ")[0] + "!";
    $("[data-avatar]").textContent = p.name.charAt(0).toUpperCase();
    $("[data-client-no]").textContent = "Клиент № " + p.client_no;
    $("[data-client-no-dd]").textContent = String(p.client_no);
    $("[data-reg-date]").textContent = date(p.created_at);
    var since = $("[data-since]");
    since.hidden = !p.created_at;
    if (p.created_at) since.textContent = sinceText(p.created_at);

    // профиль
    var pf = $("[data-profile-form]");
    pf.elements.name.value = p.name || "";
    pf.elements.phone.value = p.phone || "";
    pf.elements.phone.readOnly = !!p.phone_locked;
    $("[data-phone-hint]").textContent = p.phone_locked
      ? "Телефон закреплён за аккаунтом. Если номер сменился — позвоните нам."
      : "По телефону мы свяжемся с вами по заказу курса.";
    $("[data-email]").textContent = p.email || "не указан";
    $("[data-telegram]").textContent = p.telegram ? (p.telegram.username ? "@" + p.telegram.username : p.telegram.first_name || "привязан") : "не привязан";
    $("[data-link-tg]").hidden = !!p.telegram;
    $("[data-email-block]").hidden = !!p.email;

    // новости в Telegram — только по согласию и только при привязанном Telegram
    var news = $("[data-news]");
    news.checked = !!p.news_opt_in && !!p.telegram;
    news.disabled = !p.telegram;
    $("[data-news-hint]").textContent = p.telegram
      ? "Изредка присылаем новости и акции. Отписаться можно в любой момент — здесь или командой /stop в боте."
      : "Чтобы получать новости, сначала привяжите Telegram.";

    state("dashboard");
  }

  // ------------------------------------------------------------ загрузка
  function load() {
    return SB.rpc("my_dashboard").then(render).catch(function (err) {
      if (err.code === "not_authenticated") { SB.signOut(); state("guest"); return; }
      if (err.code === "account_blocked" || err.code === "account_inactive") SB.signOut();
      $("[data-error-text]").textContent = err.message;
      state("error");
    });
  }

  // ------------------------------------------------------------ действия
  function formStatus(form, text, ok) {
    var s = form.querySelector(".acc-status") || form.parentNode.querySelector(".acc-status");
    if (!s) return;
    s.textContent = text;
    s.className = "acc-status" + (text ? (ok ? " is-ok" : " is-error") : "");
  }
  function busy(form, on) { var b = form.querySelector(".acc-submit"); if (b) { b.disabled = on; b.classList.toggle("is-busy", on); } }

  doc.addEventListener("submit", function (e) {
    var form = e.target;
    if (form.hasAttribute("data-name-form")) {
      e.preventDefault();
      var nm = window.FZName.clean(form.elements.name.value);
      if (!window.FZName.ok(nm)) { form.elements.name.closest(".field").classList.add("is-invalid"); formStatus(form, SB.message("bad_name"), false); form.elements.name.focus(); return; }
      form.elements.name.closest(".field").classList.remove("is-invalid");
      busy(form, true);
      SB.rpc("update_my_profile", { p_name: nm, p_phone: (data && data.profile.phone) || "" })
        .then(function () { busy(form, false); formStatus(form, "", true); toast("Приятно познакомиться, " + nm.split(" ")[0] + "!"); return load(); })
        .catch(function (err) { busy(form, false); formStatus(form, err.message, false); });
    } else if (form.hasAttribute("data-profile-form")) {
      e.preventDefault();
      var pn = window.FZName.clean(form.elements.name.value);
      if (!window.FZName.ok(pn)) { formStatus(form, SB.message("bad_name"), false); form.elements.name.focus(); return; }
      busy(form, true);
      SB.rpc("update_my_profile", { p_name: pn, p_phone: form.elements.phone.value })
        .then(function () { busy(form, false); formStatus(form, "Сохранено", true); return load(); })
        .catch(function (err) { busy(form, false); formStatus(form, err.message, false); });
    } else if (form.hasAttribute("data-email-form")) {
      e.preventDefault();
      busy(form, true);
      SB.account("set_email", { email: form.elements.email.value.trim(), password: form.elements.password.value })
        .then(function (r) {
          busy(form, false);
          if (r && r.status === "verify") {
            // email привяжется после ввода кода из письма
            var cf = $("[data-email-code-form]");
            form.hidden = true; cf.hidden = false; cf.reset();
            $("[data-email-code-lead]").textContent = "Мы отправили 6-значный код на " + r.email + ". Введите его — и можно будет входить по email и паролю.";
            cf.elements.code.focus();
            return;
          }
          toast("Готово: теперь можно входить и по email"); return load();
        })
        .catch(function (err) { busy(form, false); formStatus(form, err.message, false); });
    } else if (form.hasAttribute("data-email-code-form")) {
      e.preventDefault();
      var ec = form.elements.code.value.replace(/\s+/g, "");
      if (!/^[0-9]{6}$/.test(ec)) { formStatus(form, SB.message("bad_code"), false); return; }
      busy(form, true);
      SB.account("set_email_confirm", { code: ec })
        .then(function () { toast("Готово: теперь можно входить и по email"); return load(); })
        .catch(function (err) { busy(form, false); formStatus(form, err.message, false); });
    } else if (form.hasAttribute("data-reset-form")) {
      e.preventDefault();
      var p1 = form.elements.password.value, p2 = form.elements.password2.value;
      if (p1.length < 8 || !/[0-9]/.test(p1) || !/[A-Za-zА-Яа-яЁё]/.test(p1)) { formStatus(form, SB.message("weak_password"), false); return; }
      if (p1 !== p2) { formStatus(form, "Пароли не совпадают.", false); return; }
      busy(form, true);
      SB.updatePassword(p1)
        .then(function () { toast("Пароль обновлён"); history.replaceState(null, "", "/kabinet/"); state("loading"); return load(); })
        .catch(function (err) { busy(form, false); formStatus(form, err.message, false); });
    }
  });

  doc.addEventListener("change", function (e) {
    var t = e.target;
    if (!t.matches("[data-news]")) return;
    var on = t.checked;
    t.disabled = true;
    SB.rpc("set_news_opt_in", { p_on: on })
      .then(function () {
        t.disabled = false; data.profile.news_opt_in = on;
        toast(on ? "Готово: будем присылать новости в Telegram" : "Вы отписались от новостей");
      })
      .catch(function (err) { t.disabled = false; t.checked = !on; toast(err.message); });
  });

  doc.addEventListener("click", function (e) {
    var back = e.target.closest("[data-email-back]");
    if (back) { $("[data-email-code-form]").hidden = true; $("[data-email-form]").hidden = false; return; }
    var t = e.target.closest("[data-signout],[data-delete],[data-link-tg],[data-open-auth],[data-reload]");
    if (!t) return;
    if (t.hasAttribute("data-signout")) {
      SB.signOut(); location.href = "/";
    } else if (t.hasAttribute("data-delete")) {
      if (!confirm("Удалить аккаунт? Доступ к купленным курсам будет потерян.")) return;
      SB.rpc("delete_my_account").then(function () { SB.signOut(); location.href = "/"; }).catch(function (err) { toast(err.message); });
    } else if (t.hasAttribute("data-link-tg")) {
      if (window.FZAuth) window.FZAuth.linkTelegram();
    } else if (t.hasAttribute("data-open-auth")) {
      if (window.FZAuth) window.FZAuth.open(t.getAttribute("data-open-auth"));
    } else if (t.hasAttribute("data-reload")) {
      location.reload();
    }
  });

  window.FZOnLinked = function () { load(); };

  // ------------------------------------------------------------ старт
  if (!SB || !SB.enabled) {
    $("[data-error-text]").textContent = "Личный кабинет скоро заработает. Записаться можно по телефону +7 993 044-06-19.";
    state("error");
    return;
  }
  var params = new URLSearchParams(location.search);
  var resetHash = params.get("reset");
  if (resetHash && /^[A-Za-z0-9_-]{20,200}$/.test(resetHash)) {
    SB.verifyRecovery(resetHash).then(function () { state("reset"); })
      .catch(function () {
        $("[data-error-text]").textContent = "Ссылка для смены пароля устарела или уже использована. Запросите новую в окне входа.";
        state("error");
      });
    return;
  }
  if (!SB.isSignedIn()) { state("guest"); return; }
  load();
  SB.onChange(function (signed) { if (!signed) state("guest"); });
})();
