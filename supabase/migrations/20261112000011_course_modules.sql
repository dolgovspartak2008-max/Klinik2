-- =====================================================================
-- Онлайн-курс на сайте drgorshechnikov.ru (база общая с Физиотерой).
--  * у уроков появляется «модуль» — группа внутри курса (Плечи, Локти…);
--  * функции, которые отдают уроки сайту и админке, возвращают module;
--  * курс «Здоровые суставы и спина»: 6 модулей, 10 уроков (скрыты до загрузки видео);
--  * прежние три курса и комплект «Все суставы» сняты с продажи (archived):
--    у тех, кто их купил, доступ сохраняется.
-- =====================================================================

alter table app.lessons add column if not exists module text not null default ''
  check (char_length(module) <= 60);

create or replace function public.course_detail(p_slug text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare c app.courses; v_uid uuid := auth.uid(); v_owned boolean;
begin
  select * into c from app.courses where slug = lower(btrim(coalesce(p_slug, '')));
  if not found or (c.status <> 'published' and not (v_uid is not null and app.course_has_access(v_uid, c.id))) then
    raise exception 'not_found';
  end if;
  v_owned := v_uid is not null and app.course_has_access(v_uid, c.id);
  return app.course_card(c, v_uid) || jsonb_build_object(
    'for_whom', c.for_whom, 'tasks', c.tasks, 'program', c.program, 'results', c.results,
    'recommendations', c.recommendations, 'author', c.author, 'contraindications', c.contraindications,
    'access_terms', c.access_terms, 'on_sale', c.status = 'published',
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'module', l.module, 'duration_sec', l.duration_sec,
        'is_free', l.is_free, 'description', l.description,
        'completed', v_uid is not null and exists (select 1 from app.lesson_progress p where p.user_id = v_uid and p.lesson_id = l.id and p.completed_at is not null))
        order by l.sort, l.created_at)
      from app.lessons l where l.course_id = c.id and not l.hidden and l.video_path is not null), '[]'::jsonb),
    'progress', case when v_owned then app.course_progress(v_uid, c.id) end,
    'bundles', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'title', b.title, 'price', b.price, 'old_price', b.old_price))
      from app.bundles b join app.bundle_courses bc on bc.bundle_id = b.id where bc.course_id = c.id and b.status = 'published'), '[]'::jsonb),
    'signed_in', v_uid is not null);
end $function$;

create or replace function public.course_player(p_slug text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v app.profiles; c app.courses; v_access boolean;
begin
  v := app.require_user();
  select * into c from app.courses where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then raise exception 'not_found'; end if;
  v_access := app.course_has_access(v.id, c.id);
  if c.status <> 'published' and not v_access then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'course', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'recommendations', c.recommendations,
      'contraindications', c.contraindications, 'price', c.price, 'on_sale', c.status = 'published'),
    'access', v_access, 'blocked', v.courses_blocked,
    'watermark', app.watermark(v.id),
    'progress', app.course_progress(v.id, c.id),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'module', l.module, 'description', l.description,
        'recommendations', l.recommendations, 'duration_sec', l.duration_sec, 'is_free', l.is_free, 'poster_url', l.poster_url,
        'can_watch', (v_access or l.is_free) and not v.courses_blocked,
        'position_sec', p.position_sec, 'completed', p.completed_at is not null) order by l.sort, l.created_at)
      from app.lessons l left join app.lesson_progress p on p.lesson_id = l.id and p.user_id = v.id
      where l.course_id = c.id and not l.hidden and l.video_path is not null), '[]'::jsonb));
end $function$;

create or replace function public.admin_course_get(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare c app.courses;
begin
  perform app.require_admin();
  select * into c from app.courses where id = p_id;
  if not found then raise exception 'not_found'; end if;
  return to_jsonb(c) || jsonb_build_object(
    'stats', app.course_stats(c.id),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'sort', l.sort, 'title', l.title, 'module', l.module, 'description', l.description,
        'recommendations', l.recommendations, 'has_video', l.video_path is not null, 'video_size', l.video_size,
        'duration_sec', l.duration_sec, 'poster_url', l.poster_url, 'is_free', l.is_free, 'hidden', l.hidden,
        'published_at', l.published_at,
        'viewers', (select count(*) from app.lesson_progress p where p.lesson_id = l.id),
        'completed', (select count(*) from app.lesson_progress p where p.lesson_id = l.id and p.completed_at is not null))
        order by l.sort, l.created_at) from app.lessons l where l.course_id = c.id), '[]'::jsonb),
    'students', (select count(*) from app.course_access a where a.course_id = c.id and a.revoked_at is null),
    'avg_progress', (select round(avg((app.course_progress(a.user_id, c.id) ->> 'percent')::numeric))
                     from app.course_access a where a.course_id = c.id and a.revoked_at is null));
end $function$;

create or replace function public.admin_lesson_save(p jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_admin uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; l app.lessons; old app.lessons;
  v_course uuid := nullif(p ->> 'course_id', '')::uuid; v_title text := app.txt(p, 'title', 160);
  v_module text := app.txt(p, 'module', 60);
  v_hidden boolean := coalesce((p ->> 'hidden')::boolean, true); c app.courses;
begin
  v_admin := app.require_admin();
  if char_length(v_title) < 2 then raise exception 'bad_title'; end if;
  if v_id is null then
    if v_course is null or not exists (select 1 from app.courses where id = v_course) then raise exception 'not_found'; end if;
    insert into app.lessons (course_id, sort, title, module, description, recommendations, is_free, hidden)
    values (v_course, coalesce((p ->> 'sort')::int, (select coalesce(max(sort), 0) + 1 from app.lessons where course_id = v_course)),
      v_title, v_module, app.txt(p, 'description', 4000), app.txt(p, 'recommendations', 4000),
      coalesce((p ->> 'is_free')::boolean, false), true)
    returning * into l;
  else
    select * into old from app.lessons where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    if not v_hidden and old.video_path is null then raise exception 'no_video'; end if;
    update app.lessons set title = v_title, module = case when p ? 'module' then v_module else module end,
      description = app.txt(p, 'description', 4000),
      recommendations = app.txt(p, 'recommendations', 4000), is_free = coalesce((p ->> 'is_free')::boolean, is_free),
      hidden = v_hidden, published_at = case when not v_hidden then coalesce(published_at, now()) else published_at end,
      updated_at = now()
    where id = v_id returning * into l;
    if old.published_at is null and l.published_at is not null then
      select * into c from app.courses where id = l.course_id;
      if c.status = 'published' or exists (select 1 from app.course_access a where a.course_id = c.id and a.revoked_at is null) then
        perform app.notify_user(a.user_id, 'new_lesson:' || l.id || ':' || a.user_id,
          'В курсе «' || c.title || '» новый урок: «' || l.title || '».', 'Смотреть', '/kursy/' || c.slug || '/', null)
        from app.course_access a join app.profiles pr on pr.id = a.user_id
        where a.course_id = c.id and a.revoked_at is null and pr.course_news and pr.status = 'active';
        perform app.log_event('lesson_published', 'info', null, jsonb_build_object('course', c.title, 'lesson', l.title,
          'students', (select count(*) from app.course_access a where a.course_id = c.id and a.revoked_at is null)), true, v_admin);
        perform app.call_bot('dispatch');
      end if;
    end if;
  end if;
  perform app.log_event('lesson_saved', 'info', null, jsonb_build_object('lesson', l.title, 'hidden', l.hidden, 'free', l.is_free), null, v_admin);
  return jsonb_build_object('ok', true, 'id', l.id);
end $function$;

-- ---------------------------------------------------------------- прежние курсы — с продажи
update app.bundles set status = 'archived', updated_at = now() where slug = 'vse-sustavy' and status <> 'archived';
update app.courses set status = 'archived', updated_at = now()
 where slug in ('kolennye-sustavy', 'tazobedrennye-sustavy', 'loktevoy-sustav') and status <> 'archived';

-- ---------------------------------------------------------------- новый курс
insert into app.course_categories (id, slug, title, description, sort) values
  ('6a1f0c0e-1b2a-4c3d-8e4f-000000000005', 'sustavy-i-spina', 'Суставы и спина',
   'Упражнения для плечевых, локтевых, тазобедренных и коленных суставов, стоп и спины.', 0)
on conflict (id) do nothing;

insert into app.courses (id, slug, category_id, title, short, direction, for_whom, tasks, program, results,
  recommendations, contraindications, access_terms, price, status, sort)
select '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 'zdorovye-sustavy-i-spina', '6a1f0c0e-1b2a-4c3d-8e4f-000000000005',
  'Здоровые суставы и спина',
  'Видеокурс упражнений из 6 модулей: плечи, локти, тазобедренные суставы, колени, стопы и спина. Специалист показывает каждое упражнение и объясняет технику.',
  'Суставы и спина',
  E'- тем, кто чувствует скованность или напряжение в суставах и спине после нагрузки или долгого сидения;\n- тем, у кого сидячая работа и мало движения в течение дня;\n- тем, кто после консультации врача хочет заниматься дома регулярно и по понятной программе.',
  E'- поддерживать подвижность суставов;\n- укреплять мышцы, которые стабилизируют суставы и позвоночник;\n- снижать мышечное напряжение;\n- выработать привычку к короткой регулярной зарядке.',
  E'6 модулей, 10 видеоуроков по 1–2,5 минуты:\n- Плечи — 1 урок;\n- Локти — 1 урок;\n- Тазобедренный — 2 урока;\n- Колени — 1 урок;\n- Стопы — 1 урок;\n- Спина — 4 урока.\nМодули можно проходить в любом порядке — начните с той зоны, которая беспокоит.',
  E'При регулярных занятиях можно ожидать, что мышцы станут крепче, а движения — свободнее. Результат индивидуален и зависит от состояния суставов, регулярности и соблюдения техники.',
  c.recommendations, c.contraindications, c.access_terms, null, 'draft', 0
from app.courses c where c.slug = 'kolennye-sustavy'
on conflict (id) do nothing;

insert into app.lessons (id, course_id, sort, module, title, description, hidden) values
  ('8c3f2e10-3d4c-4e5f-a061-000000000011', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 1,  'Плечи', 'Упражнения для плечевых суставов', 'Специалист показывает упражнения для плечевого сустава и объясняет технику. Двигайтесь плавно, без рывков.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000012', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 2,  'Локти', 'Упражнения для локтевого сустава', 'Комплекс для локтевого сустава и мышц предплечья. Начните с небольшого количества повторений.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000013', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 3,  'Тазобедренный', 'Тазобедренный сустав. Комплекс 1', 'Первый комплекс упражнений для тазобедренного сустава.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000014', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 4,  'Тазобедренный', 'Тазобедренный сустав. Комплекс 2', 'Второй комплекс упражнений для тазобедренного сустава.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000015', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 5,  'Колени', 'Упражнения для коленных суставов', 'Упражнения для мышц бедра и голени и подвижности колена.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000016', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 6,  'Стопы', 'Упражнения для стоп', 'Комплекс упражнений для стоп и голеностопных суставов.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000017', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 7,  'Спина', 'Спина. Комплекс 1', 'Первый комплекс упражнений для спины.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000018', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 8,  'Спина', 'Спина. Комплекс 2', 'Второй комплекс упражнений для спины.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000019', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 9,  'Спина', 'Спина. Комплекс 3', 'Третий комплекс упражнений для спины.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000020', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 10, 'Спина', 'Спина. Комплекс 4', 'Четвёртый комплекс упражнений для спины.', true)
on conflict (id) do nothing;
