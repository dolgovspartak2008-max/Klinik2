-- Уведомления по онлайн-курсам (оплата, новый урок, возврат, доступ, подарок) ведут на сайт
-- drgorshechnikov.ru и подписаны «Кабинет здоровья доктора Горшечникова».
-- Остальные уведомления (скидки, приглашения Физиотеры) — как раньше, на site_url из настроек.
create or replace function app.notify_user(p_user uuid, p_key text, p_text text, p_button_text text default null,
  p_button_url text default null, p_mail_subject text default null)
 returns void language plpgsql set search_path to ''
as $function$
declare v_tg bigint; v_email text; v_site text; v_sign text;
  v_course boolean := p_key ~ '^(order_paid|gift_activated|new_lesson|refund|manual_access|cblock):'
                      or coalesce(p_button_url, '') like '/kursy/%' or coalesce(p_button_url, '') like '/kabinet/#courses%';
begin
  select telegram_id into v_tg from app.telegram_identities where user_id = p_user;
  select email into v_email from app.profiles where id = p_user and status = 'active';
  if v_course then
    v_site := 'https://www.drgorshechnikov.ru'; v_sign := 'Кабинет здоровья доктора Горшечникова';
  else
    select site_url into v_site from app.settings; v_sign := 'Клиника «Физиотера»';
  end if;
  if v_tg is not null then
    insert into app.tg_outbox (telegram_id, user_id, kind, text, button_text, button_url, dedupe_key)
    values (v_tg, p_user, 'personal', p_text, p_button_text,
            case when p_button_url like '/%' then v_site || p_button_url else p_button_url end, 'tg:' || p_key)
    on conflict do nothing;
  end if;
  if v_email is not null and p_mail_subject is not null then
    insert into app.mail_outbox (to_email, subject, body, dedupe_key)
    values (v_email, p_mail_subject,
            p_text || case when p_button_url is not null then E'\n\n' ||
              case when p_button_url like '/%' then v_site || p_button_url else p_button_url end else '' end
              || E'\n\n—\n' || v_sign || ', ' || v_site,
            'mail:' || p_key)
    on conflict do nothing;
  end if;
end $function$;

do $$
begin
  execute replace(pg_get_functiondef('public.gift_activate'::regproc),
    'Спасибо, что выбрали «Физиотеру»!', 'Спасибо, что занимаетесь с нами!');
  execute replace(pg_get_functiondef('public.admin_courses_block'::regproc),
    '+7 (987) 600-00-37', '+7 993 044-06-19');
end $$;
