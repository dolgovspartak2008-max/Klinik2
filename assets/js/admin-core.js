(function () {
  "use strict";
  var doc = document, SB = window.SB;
  var api = { ev: {}, loaders: {} };
  window.FZAdmin = api;

  function all(selector) { return Array.prototype.slice.call(doc.querySelectorAll(selector)); }
  function state(name) { all("[data-state]").forEach(function (el) { el.hidden = el.getAttribute("data-state") !== name; }); }
  function openTab(name) {
    if (!api.loaders[name]) name = "c-courses";
    all("[data-tab]").forEach(function (tab) { tab.setAttribute("aria-selected", String(tab.getAttribute("data-tab") === name)); });
    all("[data-panel]").forEach(function (panel) { panel.hidden = panel.getAttribute("data-panel") !== name; });
    history.replaceState(null, "", "#" + name);
    api.loaders[name]();
  }

  doc.addEventListener("click", function (event) {
    var tab = event.target.closest("[data-tab]");
    if (tab && !tab.hidden) openTab(tab.getAttribute("data-tab"));
  });

  doc.addEventListener("click", function (event) {
    if (event.target.closest("[data-open-auth]") && window.FZAuth) window.FZAuth.open("login");
    if (event.target.closest("[data-signout]")) { SB.signOut(); location.href = "/"; }
    var v = event.target.closest("[data-send-verify]");
    if (v) {
      v.disabled = true;
      SB.account("verify_email", { email: v.getAttribute("data-send-verify") })
        .then(function () {
          v.hidden = true;
          var f = doc.querySelector("[data-verify-form]");
          if (f) { f.hidden = false; f.elements.code.focus(); }
        })
        .catch(function (err) { v.disabled = false; v.textContent = err.message; });
    }
  });

  doc.addEventListener("submit", function (event) {
    var f = event.target.closest("[data-verify-form]");
    if (!f) return;
    event.preventDefault();
    var code = String(f.elements.code.value || "").replace(/\s+/g, ""), st = f.querySelector(".acc-status");
    if (!/^[0-9]{4,10}$/.test(code)) { st.textContent = "Введите код из письма."; return; }
    f.querySelector("button").disabled = true;
    SB.account("verify_email_code", { email: f.getAttribute("data-verify-form"), code: code })
      .then(function () { location.reload(); })
      .catch(function (err) { f.querySelector("button").disabled = false; st.textContent = err.code === "code_expired" ? "Код неверный или устарел. Запросите новый." : err.message; });
  });

  function denied(text, html) {
    var p = doc.querySelector("[data-denied-text]");
    if (p) { if (html) p.innerHTML = html; else p.textContent = text; }
    state("denied");
  }

  if (!SB || !SB.isSignedIn()) { denied("Админ-панель открывается после входа с аккаунта администратора."); return; }
  SB.rpc("admin_me").then(function () {
    state("app");
    setTimeout(function () { openTab(location.hash.slice(1) || "c-courses"); }, 0);
  }).catch(function (err) {
    if (err.code === "email_not_verified") {
      SB.rpc("my_dashboard").then(function (d) {
        var email = (d && d.profile && d.profile.email) || "";
        denied("", "Чтобы открыть админ-панель, подтвердите email <b>" + email.replace(/[<>&"]/g, "") + "</b>.<br>" +
          '<button class="btn btn--primary" type="button" data-send-verify="' + email.replace(/[<>&"]/g, "") + '">Получить код на почту</button>' +
          '<form class="acc-form cab-narrow" data-verify-form="' + email.replace(/[<>&"]/g, "") + '" hidden novalidate>' +
          '<label class="field"><span>Код из письма</span><input name="code" class="acc-otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required /></label>' +
          '<button class="btn btn--primary acc-submit" type="submit">Подтвердить</button><p class="acc-status" role="status" aria-live="polite"></p></form>');
      }).catch(function () { denied(SB.message("email_not_verified")); });
      return;
    }
    if (err.code === "not_authenticated") { denied("Войдите с аккаунта администратора."); return; }
    denied(err.code === "forbidden" ? "У этого аккаунта нет прав администратора." : err.message);
  });
})();
