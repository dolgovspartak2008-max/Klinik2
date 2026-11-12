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

  if (!SB || !SB.enabled || !SB.isSignedIn()) { state("denied"); return; }
  SB.rpc("admin_me").then(function () {
    state("app");
    setTimeout(function () { openTab(location.hash.slice(1) || "c-courses"); }, 0);
  }).catch(function () { state("denied"); });
})();
