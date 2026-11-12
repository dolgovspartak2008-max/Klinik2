/*
 * Клиент курсов. Авторизацию ведёт Neon Auth, данные и видео выдаются
 * серверными функциями Vercel на своём домене.
 */
(function () {
  "use strict";
  var CFG = window.SITE_ACCOUNT || {};
  var BASE = "/api";
  var KEY = "";
  var STORE = "fz.auth";
  var listeners = [];
  var refreshing = null;

  var ERRORS = {
    not_authenticated: "Войдите в аккаунт, чтобы продолжить.",
    account_blocked: "Аккаунт заблокирован. Если это ошибка — позвоните нам: +7 993 044-06-19.",
    account_inactive: "Аккаунт удалён.",
    rate_limited: "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
    bad_email: "Проверьте email — похоже, в адресе опечатка.",
    weak_password: "Пароль — минимум 8 символов, хотя бы одна буква и одна цифра.",
    bad_name: "Напишите настоящее имя буквами — например, Анна или Иван Петров.",
    bad_phone: "Проверьте номер телефона: например, +7 993 044-06-19.",
    consent_required: "Нужно согласие на обработку персональных данных.",
    email_taken: "Этот email уже зарегистрирован. Войдите или восстановите пароль.",
    invalid_credentials: "Неверный email или пароль.",
    email_not_verified: "Email ещё не подтверждён — мы отправили код на почту.",
    bad_code: "Неверный код. Проверьте цифры из письма.",
    code_expired: "Код устарел или введён неверно слишком много раз. Запросите новый.",
    code_cooldown: "Код уже отправлен. Новый можно запросить через минуту.",
    code_failed: "Не удалось создать код. Попробуйте ещё раз через минуту.",
    mail_failed: "Не удалось отправить письмо. Попробуйте позже или войдите через Telegram.",
    code_empty: "Введите промокод.",
    code_not_found: "Такого промокода нет. Проверьте написание: GIFT-XXXXX.",
    own_code: "Это ваш собственный промокод — его можно только дарить друзьям.",
    already_referred: "Промокод друга уже применён к вашему аккаунту. Применить можно только один раз.",
    not_first_visit: "Промокод друга действует только до первой подтверждённой услуги.",
    program_disabled: "Реферальная программа сейчас не действует.",
    code_inactive: "Этот промокод больше не действует.",
    bonus_not_found: "Бонус не найден.",
    bonus_pending: "Запрос на этот бонус уже отправлен — администратор подтвердит его на приёме.",
    bonus_used: "Этот бонус уже использован.",
    bonus_expired: "Срок действия бонуса истёк.",
    bonus_cancelled: "Бонус отменён.",
    bad_service: "Выберите услугу из списка.",
    service_not_covered: "Этот бонус не действует на выбранную услугу.",
    phone_required: "Укажите телефон в профиле — по нему администратор узнает вас на приёме.",
    not_stackable: "Этот бонус нельзя совместить с другим, который уже ожидает подтверждения.",
    already_claimed: "На этот номер телефона подарок уже был оформлен. Он положен одному клиенту один раз.",
    phone_locked: "Телефон нельзя изменить, пока есть оформленные скидки. Позвоните нам, если номер сменился.",
    telegram_taken: "Этот Telegram уже привязан к другому аккаунту.",
    other_telegram_linked: "К аккаунту уже привязан другой Telegram.",
    telegram_not_configured: "Вход через Telegram временно недоступен.",
    email_already_set: "Email уже указан.",
    forbidden: "Нет доступа.",
    not_found: "Не найдено.",
    not_pending: "Запрос уже обработан.",
    not_confirmed: "Услуга ещё не подтверждена.",
    rule_incomplete: "Чтобы включить скидку, заполните размер, тип и срок действия (и услуги, если не «все»).",
    rule_bad_value: "Проверьте числа: размер скидки, срок и количество использований.",
    cannot_block_self: "Нельзя заблокировать себя.",
    bad_bonus: "Проверьте числа: размер скидки, срок и количество использований.",
    bad_title: "Напишите, как скидка будет называться у клиента (минимум 3 символа).",
    bad_amount: "Размер скидки: от 1 до 100% или от 1 до 100 000 ₽.",
    bad_days: "Срок действия — от 1 до 3650 дней.",
    bad_uses: "Количество использований — от 1 до 100.",
    no_services: "Отметьте хотя бы одну услугу или выберите «на все услуги».",
    user_not_active: "Клиент заблокирован или удалил аккаунт.",
    text_too_short: "Текст рассылки слишком короткий.",
    text_too_long: "Текст рассылки слишком длинный — максимум 3500 символов.",
    duplicate_broadcast: "Такая рассылка уже отправлена в течение последнего часа.",
    broadcast_limit: "Достигнут лимит: не больше 5 рассылок в сутки.",
    no_audience: "Пока никто не подписался на новости — отправлять некому.",
    no_telegram: "Привяжите Telegram к своему аккаунту, чтобы получить проверочное сообщение.",
    // онлайн-курсы
    course_unavailable: "Курс сейчас недоступен для покупки.",
    already_owned: "Этот курс уже есть в вашем кабинете.",
    bundle_overlap: "Часть курсов комплекта у вас уже есть — докупите недостающие по отдельности.",
    promo_invalid: "Такого промокода нет или он выключен.",
    promo_not_started: "Промокод ещё не начал действовать.",
    promo_expired: "Срок действия промокода закончился.",
    promo_not_applicable: "Промокод не действует на этот курс.",
    promo_exhausted: "Промокод уже использовали максимальное число раз.",
    promo_used: "Вы уже использовали этот промокод.",
    courses_blocked: "Доступ к курсам на аккаунте приостановлен. Позвоните нам: +7 993 044-06-19.",
    not_pending: "Заказ уже обработан.",
    order_not_payable: "Этот заказ нельзя оплатить — он отменён.",
    order_not_paid: "Заказ ещё не оплачен.",
    amount_mismatch: "Сумма оплаты не совпадает с суммой заказа.",
    no_access: "Урок откроется после покупки курса.",
    other_device: "Курс сейчас смотрят на другом устройстве.",
    video_unavailable: "Видео временно недоступно. Попробуйте через минуту.",
    gift_invalid: "Подарочный код не найден. Проверьте написание: FZG-XXXX-XXXX.",
    gift_used: "Этот подарочный код уже активирован.",
    gift_cancelled: "Этот подарочный код аннулирован.",
    bad_request: "Некорректный запрос. Обновите страницу.",
    bad_slug: "Адрес — латиница, цифры и дефис, например kolennye-sustavy.",
    slug_taken: "Такой адрес уже занят.",
    bad_category: "Выберите категорию.",
    bad_price: "Цена — от 0 до 1 000 000 ₽.",
    bad_old_price: "Старая цена должна быть больше текущей.",
    price_required: "Укажите цену — без неё курс нельзя продавать.",
    no_lessons: "Сначала добавьте хотя бы один опубликованный урок с видео.",
    no_video: "Загрузите видео — без него урок нельзя показать ученикам.",
    lesson_has_progress: "Урок уже смотрели ученики — удалить его нельзя, можно только скрыть.",
    category_not_empty: "В категории есть курсы — сначала перенесите их.",
    bundle_min_courses: "В комплекте должно быть хотя бы два курса.",
    bundle_courses_unpublished: "Сначала опубликуйте все курсы комплекта.",
    bad_promo_code: "Промокод — латиница, цифры и дефис, от 3 символов (не GIFT-…).",
    promo_taken: "Такой промокод уже есть.",
    method_required: "Укажите способ оплаты (например, перевод на карту).",
    reason_required: "Укажите причину.",
    video_too_big: "Файл больше 5 ГБ — сожмите видео (например, до 1080p) или разделите его на два урока.",
    r2_not_configured: "Хранилище видео ещё не подключено. Обратитесь к администратору.",
    video_format: "Нужен файл MP4 (H.264).",
    image_too_big: "Картинка больше 5 МБ.",
    image_format: "Нужна картинка JPG, PNG или WebP.",
    file_missing: "Файл не загрузился. Попробуйте ещё раз.",
    upload_unavailable: "Хранилище недоступно. Попробуйте через минуту.",
    network: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
    server_error: "Что-то пошло не так на сервере. Попробуйте ещё раз через минуту.",
    not_configured: "Личный кабинет скоро заработает.",
    auth_origin: "Вход временно недоступен: адрес сайта не разрешён в настройках авторизации.",
    email_not_verified: "Подтвердите email: откройте ссылку из письма и войдите снова."
  };

  function message(code) { return ERRORS[code] || ERRORS.server_error; }

  function SbError(code, status) { this.code = code; this.status = status; this.message = message(code); }

  // ------------------------------------------------------------ авторизация (Neon Auth)
  // Запросы идут на свой домен (/neon-auth/* → Neon Auth, правило в vercel.json):
  // cookie сессии — first-party, вход работает и в Safari с блокировкой сторонних cookie.
  // Для API сайта берём короткоживущий JWT (GET /neon-auth/token) и держим его только в памяти.
  var AUTH_BASE = "/neon-auth";
  var jwt = null, jwtExp = 0;

  function load() {
    try { return localStorage.getItem(STORE) === "1"; } catch (e) { return !!memory; }
  }
  function mark(on) {
    try { if (on) localStorage.setItem(STORE, "1"); else localStorage.removeItem(STORE); } catch (e) {}
    memory = on;
    if (!on) { jwt = null; jwtExp = 0; }
    listeners.forEach(function (fn) { try { fn(!!on); } catch (e) {} });
  }
  var memory = false;
  memory = load();

  function decodeExp(t) {
    try {
      var p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return Number(p.exp) || 0;
    } catch (e) { return 0; }
  }

  function authCall(path, opts) {
    opts = opts || {};
    return fetch(AUTH_BASE + path, {
      method: opts.method || "GET", credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).catch(function () { throw new SbError("network", 0); }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var code = String((j && j.code) || "").toUpperCase();
          var map = {
            INVALID_EMAIL_OR_PASSWORD: "invalid_credentials", USER_ALREADY_EXISTS: "email_taken",
            USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "email_taken", INVALID_EMAIL: "bad_email",
            PASSWORD_TOO_SHORT: "weak_password", PASSWORD_TOO_LONG: "weak_password", INVALID_TOKEN: "code_expired",
            EMAIL_NOT_VERIFIED: "email_not_verified", INVALID_ORIGIN: "auth_origin", TOO_MANY_REQUESTS: "rate_limited"
          };
          var err = new SbError(map[code] || (r.status === 429 ? "rate_limited" : r.status === 401 ? "not_authenticated" : "server_error"), r.status);
          err.data = j;
          throw err;
        }
        return j;
      });
    });
  }

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = authCall("/token").then(function (r) {
      if (!r || !r.token) throw new SbError("not_authenticated", 401);
      jwt = r.token; jwtExp = decodeExp(jwt);
      if (!memory) mark(true);
      return jwt;
    }).catch(function (e) {
      if (e.code !== "network") mark(false);
      return null;
    }).finally(function () { refreshing = null; });
    return refreshing;
  }

  function token() {
    if (!memory) return Promise.resolve(null);
    if (jwt && jwtExp - 60 > Date.now() / 1000) return Promise.resolve(jwt);
    return refresh();
  }

  function headers(token) {
    var h = { "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  function call(path, opts) {
    return fetch(BASE + path, opts).catch(function () { throw new SbError("network", 0); })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var code = (j && (j.error_code || j.error || j.message)) || "server_error";
            if (typeof code !== "string") code = "server_error";
            if (r.status === 401 && !ERRORS[code]) code = "not_authenticated";
            var err = new SbError(code, r.status);
            err.data = j;
            throw err;
          }
          return j;
        });
      });
  }

  // запрос к API сайта; при 401 один раз обновляем JWT и повторяем
  function apiCall(path, payload, required) {
    return token().then(function (t) {
      if (!t && required) throw new SbError("not_authenticated", 401);
      return call(path, { method: "POST", headers: headers(t), body: JSON.stringify(payload) }).catch(function (e) {
        if (e.status !== 401 || !t) throw e;
        jwt = null;
        return refresh().then(function (t2) {
          if (!t2) { if (required) throw e; return call(path, { method: "POST", headers: headers(null), body: JSON.stringify(payload) }); }
          return call(path, { method: "POST", headers: headers(t2), body: JSON.stringify(payload) });
        });
      });
    });
  }

  function rpc(fn, args) {
    var pub = ["courses_catalog", "course_detail"].indexOf(fn) >= 0;
    return apiCall("/rpc", { fn: fn, args: args || {} }, !pub).then(function (res) {
      if (res && res.ok === false && res.error) throw new SbError(res.error, 400);
      return res;
    });
  }

  function account(action, body) {
    body = body || {};
    var here = location.origin + "/kabinet/";
    if (action === "login") {
      return authCall("/sign-in/email", { method: "POST", body: { email: body.email, password: body.password, rememberMe: true } })
        .then(function () { mark(true); return refresh(); })
        .then(function (t) { if (!t) throw new SbError("not_authenticated", 401); return { session: true }; });
    }
    if (action === "signup") {
      return authCall("/sign-up/email", { method: "POST", body: { email: body.email, password: body.password, name: body.name, callbackURL: here } })
        .then(function () { mark(true); return refresh(); })
        .then(function (t) {
          if (t && body.phone) rpc("update_my_profile", { p_name: body.name, p_phone: body.phone }).catch(function () {});
          if (t) return { session: true, onboarding: null };
          return { status: "email_sent", email: body.email };
        });
    }
    if (action === "reset") {
      return authCall("/request-password-reset", { method: "POST", body: { email: body.email, redirectTo: here } })
        .then(function () { return { mail: true, status: "email_sent" }; });
    }
    if (action === "verify_email_code") {
      return authCall("/email-otp/verify-email", { method: "POST", body: { email: body.email, otp: body.code } })
        .then(function () { jwt = null; return refresh(); }).then(function () { return { ok: true }; });
    }
    if (action === "verify_email") {
      return authCall("/send-verification-email", { method: "POST", body: { email: body.email, callbackURL: location.origin + "/admin/" } })
        .then(function () { return { ok: true }; });
    }
    return Promise.reject(new SbError("bad_request", 400));
  }

  // Серверная функция онлайн-курсов (выдача видео, загрузка в админке)
  function courses(action, body) {
    return apiCall("/courses", Object.assign({ action: action }, body || {}), true);
  }

  // новый пароль по ссылке из письма (?token=…)
  function resetPassword(resetToken, pw) {
    return authCall("/reset-password", { method: "POST", body: { newPassword: pw, token: resetToken } });
  }

  function updatePassword(pw) {
    return Promise.reject(new SbError("bad_request", 400));
  }

  function signOut() {
    authCall("/sign-out", { method: "POST", body: {} }).catch(function () {});
    mark(false);
  }

  window.SB = {
    enabled: true,
    isSignedIn: function () { return !!memory; },
    onChange: function (fn) { listeners.push(fn); },
    rpc: rpc,
    account: account,
    courses: courses,
    token: token,
    base: BASE,
    key: KEY,
    resetPassword: resetPassword,
    refresh: refresh,
    updatePassword: updatePassword,
    signOut: signOut,
    message: message,
    // реферальный код из ссылки ?ref=GIFT-XXXXX хранится 30 дней
    storedRef: function () {
      try {
        var r = JSON.parse(localStorage.getItem("fz.ref") || "null");
        return r && r.until > Date.now() ? r.code : "";
      } catch (e) { return ""; }
    },
    storeRef: function (code) {
      try { localStorage.setItem("fz.ref", JSON.stringify({ code: code, until: Date.now() + 30 * 864e5 })); } catch (e) {}
    }
  };

  // Проверка имени — те же правила, что app.name_ok в БД (supabase/migrations/20261014000005_name_check.sql).
  // Мягкая: пропускает обычные имена (в т.ч. «Анна-Мария», «Мкртчян Арам»), отсекает «алшамлпмкшо», «фыва», «ааа».
  var KB_ROWS = ["йцукенгшщзхъ", "фывапролджэ", "ячсмитьбю", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  var STOP = ["тест", "test", "admin", "админ", "user", "имя", "name", "нет", "хз", "аноним", "anonymous", "qwerty", "asdf"];
  window.FZName = {
    clean: function (n) { return String(n || "").replace(/\s+/g, " ").trim(); },
    ok: function (n) {
      var v = window.FZName.clean(n).toLowerCase();
      if (v.length < 2 || v.length > 60) return false;
      if (!/^[a-zа-яё]+([ '-][a-zа-яё]+){0,3}$/.test(v)) return false;
      if (/[a-z]/.test(v) && /[а-яё]/.test(v)) return false;
      if (/(.)\1\1/.test(v)) return false;
      if (/[бвгджзйклмнпрстфхцчшщъь]{6}/.test(v) || /[bcdfghjklmnpqrstvwxz]{6}/.test(v)) return false;
      var words = v.split(/[ '-]/);
      for (var i = 0; i < words.length; i++) {
        if (!/[аеёиоуыэюяaeiouy]/.test(words[i]) || words[i].length > 20 || /^[ъьы]/.test(words[i])) return false;
      }
      for (var r = 0; r < KB_ROWS.length; r++) {
        for (var j = 0; j + 4 <= KB_ROWS[r].length; j++) {
          var seq = KB_ROWS[r].substr(j, 4);
          if (v.indexOf(seq) >= 0 || v.indexOf(seq.split("").reverse().join("")) >= 0) return false;
        }
      }
      return STOP.indexOf(v) < 0;
    }
  };

  // синхронизация входа/выхода между вкладками
  window.addEventListener("storage", function (e) {
    if (e.key === STORE) { memory = load(); listeners.forEach(function (fn) { try { fn(!!memory); } catch (x) {} }); }
  });
})();
