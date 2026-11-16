/* Личный кабинет: «Мои курсы», заказы, активация подарочного кода. */
(function () {
  "use strict";
  var doc = document, SB = window.SB, C = window.FZC;
  if (!SB || !C || !SB.enabled) return;
  var esc = C.esc;
  function $(s, r) { return (r || doc).querySelector(s); }
  var block = $("[data-my-courses-block]");
  if (!block) return;

  var SRC = { purchase: "Куплен", bundle: "Куплен в комплекте", gift: "Получен в подарок", manual: "Выдан клиникой", promo: "Получен по промокоду" };
  var ST = { pending: "ожидает оплаты", paid: "оплачен", cancelled: "отменён", expired: "истёк срок оплаты", refunded: "возврат" };

  function date(iso) { return iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : ""; }

  function render(d) {
    var list = $("[data-my-courses]");
    if (d.blocked) {
      list.innerHTML = '<p class="buy-note buy-note--warn">Доступ к курсам на аккаунте приостановлен. Если это ошибка — позвоните в клинику: +7 993 044-06-19.</p>';
    } else if (!d.courses.length) {
      list.innerHTML = '<div class="cab-empty">У вас пока нет курсов. Видеозанятия для суставов и спины — в <a href="/kursy/"><b>каталоге курсов</b></a>.</div>';
    } else {
      list.innerHTML = d.courses.map(function (c) {
        var p = c.progress || {};
        var finished = p.total > 0 && p.completed >= p.total;
        var learn = "/kursy/" + encodeURIComponent(c.slug) + "/uroki/";
        return '<article class="my-course' + (finished ? " is-finished" : "") + '">' + C.cover(c) +
          "<div><h3>" + esc(c.title) + (finished ? ' <span class="my-course__done">🎉 Курс пройден</span>' : "") + '</h3><p class="my-course__meta">' +
          esc(c.category ? c.category.title : "") + " · " + (SRC[c.source] || "Приобретён") + " " + date(c.granted_at) +
          (c.expires_at ? " · доступ до " + date(c.expires_at) : "") + "</p>" +
          '<div class="crs-progress"><i style="width:' + (p.percent || 0) + '%"></i></div>' +
          '<p class="my-course__meta">Пройдено ' + (p.completed || 0) + " из " + (p.total || 0) + " · " + (p.percent || 0) + "%" +
          (c.last_lesson_title ? " · последний урок: «" + esc(c.last_lesson_title) + "»" : "") + "</p></div>" +
          '<a class="btn btn--primary btn--sm" href="' + learn + '">' + (finished ? "Пересмотреть уроки" : p.completed || p.last_lesson_id ? "Продолжить обучение" : "Начать") + "</a></article>";
      }).join("");
    }
    var orders = d.orders || [], online = !!d.online_payment;
    $("[data-my-orders-wrap]").hidden = !orders.length;
    $("[data-my-orders]").innerHTML = orders.map(function (o) {
      return '<div class="my-order"><span><b>№ ' + o.order_no + "</b> · " + esc(o.title) + (o.is_gift ? " (подарок)" : "") + " · " + C.money(o.total) + "</span>" +
        "<span>" + (ST[o.status] || o.status) + (o.status === "pending" ? ' · <button class="acc-link" type="button" data-cancel-order="' + esc(o.id) + '">отменить</button>' : "") + "</span>" +
        (o.status === "pending" && online && Number(o.total) > 0 ? '<span><button class="btn btn--accent btn--sm" type="button" data-pay-order="' + esc(o.id) + '">Оплатить ' + C.money(o.total) + "</button></span>" : "") +
        (o.gift ? '<span>Подарочный код: <code>' + esc(o.gift.code) + "</code> " + (o.gift.status === "activated" ? "— активирован" : o.gift.status === "cancelled" ? "— аннулирован" : "— передайте получателю") + "</span>" : "") +
        (o.status === "pending" ? '<span class="cab-muted cab-small">' + (online ? "Оплата картой или через СБП на странице ЮKassa. Доступ откроется сразу после оплаты." : "Администратор свяжется с вами для оплаты. Доступ откроется автоматически после подтверждения.") + "</span>" : "") +
        "</div>";
    }).join("");
  }

  function load() {
    return SB.rpc("my_courses").then(render).catch(function (e) {
      if (e.code === "not_authenticated") { block.hidden = true; return; }
      $("[data-my-courses]").innerHTML = '<p class="acc-status is-error">' + esc(e.message) + "</p>";
    });
  }

  if (!SB.isSignedIn()) return;
  load().then(function () {
    if (location.hash !== "#courses") return;
    var n = 0, t = setInterval(function () {
      if (block.offsetParent || ++n > 40) { clearInterval(t); if (block.offsetParent) block.scrollIntoView({ block: "start" }); }
    }, 150);
  });

  // ------------------------------------------------------------ возврат со страницы оплаты ЮKassa
  // (?order=<id>): спрашиваем у сервера статус — он сам перепроверит платёж в ЮKassa.
  var payBox = $("[data-pay-result]");
  function payResult(html, kind) {
    payBox.className = "pay-result" + (kind ? " is-" + kind : "");
    payBox.innerHTML = html;
    payBox.hidden = false;
  }
  function checkReturn() {
    var id = new URLSearchParams(location.search).get("order");
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return;
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
    payResult('<span class="cab-spinner" aria-hidden="true"></span> Проверяем оплату…', "wait");
    var tries = 0;
    (function poll() {
      SB.rpc("course_payment_check", { p_order: id }).then(function (r) {
        if (r.status === "paid") {
          var learn = r.course_slug ? "/kursy/" + encodeURIComponent(r.course_slug) + "/uroki/" : "";
          payResult("<b>Оплата прошла — спасибо!</b><span>Заказ № " + esc(r.order_no) + ": курс «" + esc(r.title) + "» уже в вашем кабинете.</span>" +
            (learn ? '<a class="btn btn--primary btn--sm" href="' + learn + '">Перейти к обучению</a>' : ""), "ok");
          load();
          return;
        }
        if (r.status === "canceled") {
          payResult("<b>Оплата не прошла</b><span>Деньги не списаны. Можно попробовать ещё раз — кнопка «Оплатить» в списке заказов ниже.</span>", "error");
          load();
          return;
        }
        // СБП и некоторые банки подтверждают дольше минуты — ждём до ~3 минут, потом проверяем реже
        if (r.status === "waiting") {
          tries++;
          if (tries === 8) payResult('<span class="cab-spinner" aria-hidden="true"></span> <b>Ждём подтверждения от банка</b><span>Обычно это занимает до пары минут. Страницу можно не обновлять — доступ откроется сам.</span>', "wait");
          if (tries < 60) { setTimeout(poll, tries < 20 ? 3000 : 10000); return; }
          payResult("<b>Банк ещё не подтвердил оплату</b><span>Если деньги списались, доступ откроется автоматически — загляните в кабинет чуть позже или напишите нам, номер заказа есть в списке ниже.</span>", "wait");
          return;
        }
        load();
      }).catch(function (e) { payResult("<b>Не удалось проверить оплату</b><span>" + esc(e.message) + "</span>", "error"); });
    })();
  }
  checkReturn();

  block.addEventListener("click", function (e) {
    var pb = e.target.closest("[data-pay-order]");
    if (pb) {
      if (!window.FZPay) return;
      pb.disabled = true; pb.classList.add("is-busy");
      window.FZPay(pb.getAttribute("data-pay-order")).catch(function (err) {
        pb.disabled = false; pb.classList.remove("is-busy");
        if (window.FZToast) window.FZToast(err.message);
      });
      return;
    }
    var b = e.target.closest("[data-cancel-order]");
    if (!b) return;
    if (!confirm("Отменить заказ?")) return;
    b.disabled = true;
    SB.rpc("course_order_cancel", { p_order: b.getAttribute("data-cancel-order") })
      .then(function () { if (window.FZToast) window.FZToast("Заказ отменён"); load(); })
      .catch(function (err) { b.disabled = false; if (window.FZToast) window.FZToast(err.message); });
  });

})();
