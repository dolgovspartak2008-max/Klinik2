/*
 * Админ-панель: «Ученики» (кто зарегистрирован, что купил, сколько прошёл) и «Журнал»
 * (все действия на сайте: входы, заказы, оплаты, просмотры уроков, действия администратора).
 * Данные отдаёт сервер (admin_students, admin_student, admin_activity) только администратору.
 */
(function () {
  "use strict";
  var doc = document, SB = window.SB, A = window.FZAdmin, C = window.FZC;
  if (!SB || !A || !C) return;
  var esc = C.esc, money = C.money;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function dt(iso) { return iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
  function ago(iso) {
    if (!iso) return "—";
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 2) return "только что";
    if (m < 60) return m + " мин назад";
    if (m < 60 * 24) return Math.round(m / 60) + " ч назад";
    if (m < 60 * 24 * 7) return Math.round(m / 1440) + " дн назад";
    return dt(iso);
  }
  function mmss(sec) { sec = Math.round(Number(sec) || 0); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function chip(st, label) { return '<span class="chip-status is-' + esc(st) + '">' + esc(label) + "</span>"; }
  function kpi(l, v, s) { return '<div class="adm-kpi"><span>' + l + "</span><b>" + v + "</b>" + (s ? "<small>" + s + "</small>" : "") + "</div>"; }
  function labelTables(root) {
    $$("table.adm-table", root).forEach(function (t) {
      var heads = $$("thead th", t).map(function (th) { return th.textContent; });
      $$("tbody tr", t).forEach(function (tr) { Array.prototype.forEach.call(tr.children, function (td, i) { td.setAttribute("data-label", heads[i] || ""); }); });
    });
  }
  function errorBox(e) { return '<p class="acc-status is-error">' + esc(e && e.message ? e.message : "Ошибка") + "</p>"; }

  var O_STATUS = { pending: "ждёт оплаты", paid: "оплачен", cancelled: "отменён", expired: "просрочен", refunded: "возврат" };
  var SRC = { purchase: "покупка", manual: "выдан вручную", gift: "подарок", bundle: "комплект" };
  var END = { replaced: "перенесён на другое устройство", stopped: "закрыт", expired: "по таймауту", renewed: "продлён", revoked: "доступ закрыт" };

  // ---------------------------------------------------------------- текст события
  var LABEL = {
    signup: "Регистрация на сайте", visit: "Заход на сайт", profile_updated: "Изменён профиль", account_deleted: "Аккаунт удалён",
    order_created: "Оформлен заказ", order_cancelled: "Заказ отменён", payment_started: "Переход к оплате",
    payment_canceled: "Оплата не прошла", payment_amount_mismatch: "Сумма оплаты не совпала с заказом",
    order_paid: "Курс оплачен", order_refunded: "Возврат", access_revoked: "Доступ к курсу закрыт",
    lesson_opened: "Открыт урок", lesson_completed: "Урок пройден", course_completed: "Курс пройден полностью",
    video_denied: "Попытка открыть урок без доступа", other_device_blocked: "Попытка смотреть на втором устройстве одновременно",
    device_switched: "Просмотр перенесён на другое устройство",
    admin_course_saved: "Курс сохранён", admin_course_status: "Изменён статус курса", admin_lesson_saved: "Урок изменён",
    admin_lesson_published: "Урок опубликован", admin_lesson_hidden: "Урок скрыт", admin_lessons_reordered: "Изменён порядок уроков",
    admin_video_uploaded: "Загружено видео урока", admin_lesson_deleted: "Урок удалён",
    admin_category_saved: "Категория сохранена", admin_category_deleted: "Категория удалена"
  };
  var WARN = { video_denied: 1, other_device_blocked: 1, device_switched: 1, payment_canceled: 1 };
  var ALERT = { payment_amount_mismatch: 1, order_refunded: 1, access_revoked: 1, account_deleted: 1 };
  var GOOD = { order_paid: 1, course_completed: 1 };
  var C_STATUS = { draft: "черновик", published: "в продаже", archived: "снят с продажи" };

  function lessonName(l) { return l ? "«" + esc((l.module ? l.module + " · " : "") + (l.title || "урок удалён")) + "»" : ""; }
  function eventText(e) {
    var d = e.details || {}, parts = [];
    var order = e.order && e.order.no ? "заказ № " + esc(e.order.no) : "";
    var course = e.course && e.course.title ? "«" + esc(e.course.title) + "»" : "";
    switch (e.type) {
      case "profile_updated": parts.push(esc((d.changed || []).join(", "))); break;
      case "order_created": parts.push(order, course, d.total != null ? money(d.total) : ""); break;
      case "order_cancelled": parts.push(order, course, d.by === "admin" ? "администратором" + (d.reason ? ": " + esc(d.reason) : "") : "клиентом"); break;
      case "payment_started": parts.push(order, course, d.total != null ? money(d.total) : "", "ЮKassa"); break;
      case "payment_canceled": parts.push(order, d.reason ? "причина ЮKassa: " + esc(d.reason) : ""); break;
      case "payment_amount_mismatch": parts.push(order, "ожидали " + money(d.expected) + ", пришло " + money(d.got)); break;
      case "order_paid": parts.push(order, course, d.total != null ? money(d.total) : "", esc(d.method || ""), d.by === "admin" ? "отметил администратор" : ""); break;
      case "order_refunded": parts.push(order, course, d.total != null ? money(d.total) : "", d.reason ? "«" + esc(d.reason) + "»" : "", d.revoked ? "доступ закрыт" : "доступ оставлен"); break;
      case "access_revoked": parts.push(course, order); break;
      case "lesson_opened": case "lesson_completed": case "video_denied": case "other_device_blocked": case "device_switched":
        parts.push(lessonName(e.lesson), course, d.free ? "бесплатный урок" : ""); break;
      case "course_completed": parts.push(course); break;
      case "admin_course_saved": parts.push(course, d.new ? "новый" : "", d.price != null ? "цена " + money(d.price) : ""); break;
      case "admin_course_status": parts.push(course, "→ " + esc(C_STATUS[d.status] || d.status || "")); break;
      case "admin_lesson_saved": case "admin_lesson_published": case "admin_lesson_hidden": parts.push(lessonName(e.lesson), d.new ? "новый урок" : ""); break;
      case "admin_video_uploaded": parts.push(lessonName(e.lesson), d.size ? (d.size / 1048576).toFixed(0) + " МБ" : "", d.replaced ? "заменено прежнее" : ""); break;
      case "admin_lesson_deleted": parts.push("«" + esc(d.title || "") + "»", course); break;
      case "admin_category_saved": case "admin_category_deleted": parts.push("«" + esc(d.title || "") + "»"); break;
      case "admin_lessons_reordered": parts.push(course); break;
    }
    if (d.device) parts.push('<span class="cab-muted">' + esc(d.device) + "</span>");
    return parts.filter(Boolean).join(" · ");
  }
  function who(e, inCard) {
    if (inCard) return e.actor_is_admin ? '<span class="adm-ev__who">админ ' + esc(e.actor || "") + "</span>" : "";
    var u = e.user;
    var name = u ? '<button class="acc-link" type="button" data-st-open="' + esc(u.id) + '">' + esc(u.name || u.email || "клиент") + "</button>" +
      (u.name && u.email ? ' <small class="cab-muted">' + esc(u.email) + "</small>" : "") : (e.type.indexOf("admin_") === 0 ? "" : "ЮKassa");
    var admin = e.actor_is_admin ? ' <span class="chip-status is-used">админ ' + esc(e.actor || "") + "</span>" : "";
    return '<span class="adm-ev__who">' + name + admin + "</span>";
  }
  function eventRow(e, inCard) {
    var cls = ALERT[e.type] ? " adm-ev--alert" : WARN[e.type] ? " adm-ev--warn" : GOOD[e.type] ? " adm-ev--good" : "";
    var text = eventText(e);
    return '<li class="adm-ev' + cls + '"><time datetime="' + esc(e.at) + '" title="' + esc(dt(e.at)) + '">' + esc(dt(e.at)) + "</time>" +
      who(e, inCard) + "<b>" + esc(LABEL[e.type] || e.type) + "</b>" + (text ? "<small>" + text + "</small>" : "") + "</li>";
  }

  // ---------------------------------------------------------------- вкладка «Журнал»
  var lastId = null;
  function logArgs(before) {
    return { p_group: $("[data-log-group]").value, p_q: $("[data-log-q]").value.trim(), p_visits: $("[data-log-visits]").checked, p_before: before || null, p_limit: 50 };
  }
  function loadLog(more) {
    var list = $("[data-log-list]"), btn = $("[data-log-more]");
    if (!more) {
      lastId = null;
      list.innerHTML = '<li class="cab-muted">Загрузка…</li>';
      SB.rpc("admin_activity_summary").then(function (s) {
        $("[data-log-kpis]").innerHTML =
          kpi("Активны сегодня", s.active_day, "за 7 дней: " + s.active_week) +
          kpi("Оплат за 7 дней", s.paid_week, "новых регистраций: " + s.signups_week) +
          kpi("Открыто уроков", s.views_week, "за 7 дней") +
          kpi("Подозрительное", s.alerts_week, "за 7 дней");
      }).catch(function () { $("[data-log-kpis]").innerHTML = ""; });
    }
    btn.disabled = true;
    return SB.rpc("admin_activity", logArgs(more ? lastId : null)).then(function (items) {
      var html = items.map(function (e) { return eventRow(e, false); }).join("");
      if (more) list.insertAdjacentHTML("beforeend", html);
      else list.innerHTML = html || '<li class="cab-empty">Событий пока нет. Они появятся, когда клиенты начнут заходить, покупать и смотреть уроки.</li>';
      if (items.length) lastId = items[items.length - 1].id;
      btn.hidden = items.length < 50;
      btn.disabled = false;
    }).catch(function (e) { list.innerHTML = errorBox(e); btn.disabled = false; });
  }

  // ---------------------------------------------------------------- вкладка «Ученики»
  function loadStudents() {
    var box = $("[data-st-list]");
    box.innerHTML = '<p class="cab-muted">Загрузка…</p>';
    return SB.rpc("admin_students", { p_q: $("[data-st-q]").value.trim(), p_filter: $("[data-st-filter]").value }).then(function (r) {
      var t = r.totals || {};
      $("[data-st-kpis]").innerHTML = kpi("Учеников", t.total || 0, "новых за 7 дней: " + (t.new_week || 0)) +
        kpi("Купили курс", t.buyers || 0, "") + kpi("Были на сайте", t.seen_week || 0, "за 7 дней") +
        kpi("Без покупки", Math.max((t.total || 0) - (t.buyers || 0), 0), "зарегистрировались, но не купили");
      if (!r.students.length) { box.innerHTML = '<p class="cab-empty">Никого не нашли.</p>'; return; }
      box.innerHTML = '<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Ученик</th><th>Курсы</th><th>Оплачено</th><th>Пройдено уроков</th><th>Последнее действие</th><th>Был на сайте</th><th></th></tr></thead><tbody>' +
        r.students.map(function (s) {
          var courses = s.courses.length ? s.courses.map(function (c) { return c.revoked ? chip("cancelled", c.title + " — закрыт") : chip("confirmed", c.title); }).join(" ") : '<span class="cab-muted">нет</span>';
          if (s.pending_orders) courses += " " + chip("pending", "ждёт оплаты: " + s.pending_orders);
          return "<tr><td><b>" + esc(s.name || "без имени") + "</b>" + (s.role === "admin" ? " " + chip("used", "админ") : "") + (s.status !== "active" ? " " + chip("cancelled", "аккаунт удалён") : "") +
            '<br><small class="cab-muted">' + esc(s.email) + (s.phone ? " · " + esc(s.phone) : "") + '</small> <span class="adm-no">№ ' + esc(s.client_no) + "</span></td>" +
            "<td>" + courses + "</td><td>" + (s.paid_total ? money(s.paid_total) : "—") + "</td><td>" + s.lessons_done + "</td>" +
            "<td>" + (s.last_action ? esc(LABEL[s.last_action] || s.last_action) + '<br><small class="cab-muted">' + esc(ago(s.last_action_at)) + "</small>" : "—") + "</td>" +
            '<td title="' + esc(dt(s.last_seen_at)) + '">' + esc(ago(s.last_seen_at)) + '<br><small class="cab-muted">рег. ' + esc(dt(s.created_at)) + "</small></td>" +
            '<td><button class="acc-link" type="button" data-st-open="' + esc(s.id) + '">Подробнее</button></td></tr>';
        }).join("") + "</tbody></table></div>";
      labelTables(box);
    }).catch(function (e) { box.innerHTML = errorBox(e); });
  }

  // ---------------------------------------------------------------- карточка ученика
  var modal = $("#userModal"), detail = $("[data-user-detail]");
  function closeCard() { modal.hidden = true; doc.body.classList.remove("has-modal"); detail.innerHTML = ""; delete modal.dataset.userId; }
  modal.addEventListener("click", function (e) { if (e.target.closest("[data-close-user]")) closeCard(); });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeCard(); });

  function openCard(userId) {
    modal.dataset.userId = userId;
    modal.hidden = false; doc.body.classList.add("has-modal");
    detail.innerHTML = '<p class="cab-muted">Загрузка…</p>';
    SB.rpc("admin_student", { p_user: userId }).then(function (x) {
      var p = x.profile;
      var titles = {};
      x.access.forEach(function (a) { titles[a.course_id] = a.title; });
      detail.innerHTML = '<h2 id="userModalTitle">' + esc(p.name || "Без имени") + ' <span class="adm-no">№ ' + esc(p.client_no) + "</span></h2>" +
        '<p class="cab-muted">' + esc(p.email) + (p.phone ? " · " + esc(p.phone) : "") + "<br>Регистрация: " + esc(dt(p.created_at)) +
        " · был на сайте: " + esc(ago(p.last_seen_at)) + " · устройств для просмотра за 30 дней: <b>" + x.devices_30d + "</b>" +
        (p.status !== "active" ? "<br>" + chip("cancelled", "аккаунт удалён клиентом") : "") + "</p>" +

        "<h3>Курсы</h3>" + (x.access.length ? '<ul class="adm-list">' + x.access.map(function (a) {
          return "<li><b>" + esc(a.title) + "</b> · " + esc(SRC[a.source] || a.source) + " · с " + esc(dt(a.granted_at)) +
            " · пройдено " + a.completed + " из " + a.total + " (" + a.percent + "%)" +
            '<span class="adm-progress" aria-hidden="true"><i style="width:' + a.percent + '%"></i></span>' +
            (a.revoked_at ? " " + chip("cancelled", "доступ закрыт " + dt(a.revoked_at)) : "") + "</li>";
        }).join("") + "</ul>" : '<p class="cab-muted">Курсов нет.</p>') +

        (x.lessons.length ? "<h3>Уроки</h3><div class=\"adm-table-wrap\"><table class=\"adm-table\"><thead><tr><th>Урок</th><th>Досмотрел до</th><th>Статус</th><th>Последний раз</th></tr></thead><tbody>" +
          x.lessons.map(function (l) {
            return "<tr><td>" + lessonName(l) + (titles[l.course_id] ? '<br><small class="cab-muted">' + esc(titles[l.course_id]) + "</small>" : "") + "</td>" +
              "<td>" + mmss(l.position_sec) + (l.duration_sec ? " из " + mmss(l.duration_sec) : "") + "</td>" +
              "<td>" + (l.completed_at ? chip("confirmed", "пройден") : chip("pending", "начат")) + "</td><td>" + esc(dt(l.updated_at)) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : "") +

        "<h3>Заказы</h3>" + (x.orders.length ? '<ul class="adm-list">' + x.orders.map(function (o) {
          return "<li>№ " + esc(o.order_no) + " · " + esc(o.title) + " · " + money(o.total) + " · " + chip(o.status === "paid" ? "confirmed" : o.status, O_STATUS[o.status] || o.status) +
            " · " + esc(dt(o.created_at)) + (o.paid_at ? " · оплачен " + esc(dt(o.paid_at)) : "") + (o.payment_method ? " · " + esc(o.payment_method) : "") +
            (o.note ? ' · <small class="cab-muted">' + esc(o.note) + "</small>" : "") + "</li>";
        }).join("") + "</ul>" : '<p class="cab-muted">Заказов нет.</p>') +

        (x.sessions.length ? "<h3>Просмотры видео</h3><ul class=\"adm-list\">" + x.sessions.map(function (s) {
          return "<li>" + esc(dt(s.started_at)) + " — " + (s.ended_at ? esc(dt(s.ended_at)) + " (" + esc(END[s.end_reason] || s.end_reason || "") + ")" : "идёт сейчас") +
            " · «" + esc(s.lesson) + '» · <small class="cab-muted">устройство ' + esc(s.device) + "</small></li>";
        }).join("") + "</ul>" : "") +

        "<h3>Журнал действий</h3>" + (x.events.length ? '<ol class="adm-events adm-events--compact">' + x.events.map(function (e) { return eventRow(e, true); }).join("") + "</ol>"
          : '<p class="cab-muted">Событий пока нет (журнал ведётся с момента обновления сайта).</p>');
      labelTables(detail);
    }).catch(function (e) { detail.innerHTML = errorBox(e); });
  }

  // ---------------------------------------------------------------- события
  doc.addEventListener("click", function (e) {
    var t = e.target.closest("[data-st-open]");
    if (t) { e.preventDefault(); openCard(t.getAttribute("data-st-open")); return; }
    if (e.target.closest("[data-log-more]")) loadLog(true);
    if (e.target.closest("[data-log-refresh]")) loadLog(false);
  });
  $("[data-log-form]").addEventListener("submit", function (e) { e.preventDefault(); loadLog(false); });
  $("[data-log-group]").addEventListener("change", function () { loadLog(false); });
  $("[data-log-visits]").addEventListener("change", function () { loadLog(false); });
  $("[data-st-form]").addEventListener("submit", function (e) { e.preventDefault(); loadStudents(); });
  $("[data-st-filter]").addEventListener("change", loadStudents);

  Object.assign(A.loaders, { "c-students": loadStudents, "c-log": function () { loadLog(false); } });
})();
