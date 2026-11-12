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
 * Supabase — база общая с сайтом Физиотеры (fiziotera.online).
 *   supabaseUrl — прокси на этом же домене (правило /sb/ в vercel.json).
 *   anonKey     — публичный (anon) ключ, не секретный: доступ ограничен проверками в базе.
 *   coursesOnly — кабинет только для курсов: скидки и промокоды друзей Физиотеры не показываются.
 */
window.SITE_ACCOUNT = {
  supabaseUrl: "/sb",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwdWpzd3FvdmhlbWJzaHZheGZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjIwNTksImV4cCI6MjEwNzI5ODA1OX0.7ptbrwm-pSPn8UunJ4_s8-4i8QVKZFOCUICM35MKXTI",
  coursesOnly: true
};
