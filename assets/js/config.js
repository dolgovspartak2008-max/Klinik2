/*
 * Настройки личного кабинета и онлайн-курсов (сайт Кабинета здоровья доктора Горшечникова).
 * Используются только страницами /kursy/, /kabinet/, /admin/ и политикой конфиденциальности —
 * главная страница работает без этого файла.
 */
window.SITE_CONTACTS = {
  phone: "+79930440619",
  phoneLabel: "+7 993 044-06-19",
  whatsapp: "https://api.whatsapp.com/send?phone=79930440619",
  address: "Салават, ул. Юлаева, 29а, Дом Быта, 3 этаж"
};

window.SITE_LEGAL = {
  name: "ИП Горшечников Андрей Сергеевич",
  inn: "026616663545",
  ogrn: "321028000040639",
  legalAddress: "",
  email: ""
};

/*
 * Курсы используют Neon Auth, Neon Postgres и серверные функции Vercel.
 */
window.SITE_ACCOUNT = {
  coursesOnly: true
};
