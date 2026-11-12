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
        .then(function () { v.textContent = "Письмо отправлено — откройте ссылку из него"; })
        .catch(function (err) { v.disabled = false; v.textContent = err.message; });
    }
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
          '<button class="btn btn--primary" type="button" data-send-verify="' + email.replace(/[<>&"]/g, "") + '">Отправить письмо для подтверждения</button>' +
          "<br><small>После подтверждения выйдите и войдите снова.</small>");
      }).catch(function () { denied(SB.message("email_not_verified")); });
      return;
    }
    if (err.code === "not_authenticated") { denied("Войдите с аккаунта администратора."); return; }
    denied(err.code === "forbidden" ? "У этого аккаунта нет прав администратора." : err.message);
  });
})();
