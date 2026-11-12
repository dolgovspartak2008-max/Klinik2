create extension if not exists pgcrypto;

create table if not exists profiles (
  id text primary key,
  email text not null unique,
  name text not null default '',
  phone text not null default '',
  role text not null default 'student' check (role in ('student', 'admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  course_news boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists course_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  sort integer not null default 0
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category_id uuid references course_categories(id) on delete set null,
  title text not null,
  short text not null default '',
  direction text not null default '',
  for_whom text not null default '',
  tasks text not null default '',
  program text not null default '',
  results text not null default '',
  recommendations text not null default '',
  author text not null default 'Специалисты Кабинета здоровья доктора Горшечникова',
  contraindications text not null default '',
  access_terms text not null default 'Доступ без ограничения срока. Курс предназначен для личного использования.',
  price numeric(12,2),
  old_price numeric(12,2),
  cover_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  sort integer not null default 0,
  module text not null default '',
  title text not null,
  description text not null default '',
  recommendations text not null default '',
  duration_sec integer,
  poster_url text,
  video_path text,
  video_size bigint,
  is_free boolean not null default false,
  hidden boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists course_orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity unique,
  user_id text not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id),
  total numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  idempotency_key text not null,
  payment_method text,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (user_id, idempotency_key)
);

create table if not exists course_access (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  source text not null default 'purchase',
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, course_id)
);

create table if not exists lesson_progress (
  user_id text not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  position_sec numeric(12,2) not null default 0,
  duration_sec integer,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists playback_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  device_id text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
);

create index if not exists lessons_course_sort_idx on lessons(course_id, sort);
create index if not exists orders_user_created_idx on course_orders(user_id, created_at desc);
create index if not exists access_user_active_idx on course_access(user_id, course_id) where revoked_at is null;
create index if not exists sessions_user_active_idx on playback_sessions(user_id) where ended_at is null;

insert into course_categories (id, slug, title, description, sort) values
  ('6a1f0c0e-1b2a-4c3d-8e4f-000000000005', 'sustavy-i-spina', 'Суставы и спина',
   'Упражнения для плечевых, локтевых, тазобедренных и коленных суставов, стоп и спины.', 0)
on conflict (id) do nothing;

insert into courses (id, slug, category_id, title, short, direction, for_whom, tasks, program, results,
  recommendations, contraindications, access_terms, price, status, sort) values
  ('7b2e1d0f-2c3b-4d4e-9f50-000000000010', 'zdorovye-sustavy-i-spina', '6a1f0c0e-1b2a-4c3d-8e4f-000000000005',
   'Здоровые суставы и спина',
   'Видеокурс упражнений из 6 модулей: плечи, локти, тазобедренные суставы, колени, стопы и спина.',
   'Суставы и спина',
   '- тем, кто чувствует скованность после нагрузки или долгого сидения;\n- тем, у кого сидячая работа;\n- тем, кто после консультации врача хочет заниматься дома.',
   '- поддерживать подвижность суставов;\n- укреплять мышцы;\n- снижать мышечное напряжение.',
   '6 модулей, 10 видеоуроков: плечи, локти, тазобедренные суставы, колени, стопы и спина.',
   'Результат индивидуален и зависит от регулярности занятий и соблюдения техники.',
   'Занимайтесь без резкой боли. Двигайтесь плавно и прекратите упражнение при ухудшении самочувствия.',
   'Острые боли, травмы, недавние операции и состояния, при которых врач ограничил физическую нагрузку.',
   'Доступ без ограничения срока. Материалы предназначены для личного использования.',
   null, 'draft', 0)
on conflict (id) do nothing;

insert into lessons (id, course_id, sort, module, title, description, hidden) values
  ('8c3f2e10-3d4c-4e5f-a061-000000000011', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 1,  'Плечи', 'Упражнения для плечевых суставов', 'Двигайтесь плавно, без рывков.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000012', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 2,  'Локти', 'Упражнения для локтевого сустава', 'Начните с небольшого количества повторений.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000013', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 3,  'Тазобедренный', 'Тазобедренный сустав. Комплекс 1', 'Первый комплекс упражнений.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000014', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 4,  'Тазобедренный', 'Тазобедренный сустав. Комплекс 2', 'Второй комплекс упражнений.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000015', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 5,  'Колени', 'Упражнения для коленных суставов', 'Комплекс для мышц бедра и голени.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000016', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 6,  'Стопы', 'Упражнения для стоп', 'Комплекс для стоп и голеностопных суставов.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000017', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 7,  'Спина', 'Спина. Комплекс 1', 'Первый комплекс упражнений для спины.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000018', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 8,  'Спина', 'Спина. Комплекс 2', 'Второй комплекс упражнений для спины.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000019', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 9,  'Спина', 'Спина. Комплекс 3', 'Третий комплекс упражнений для спины.', true),
  ('8c3f2e10-3d4c-4e5f-a061-000000000020', '7b2e1d0f-2c3b-4d4e-9f50-000000000010', 10, 'Спина', 'Спина. Комплекс 4', 'Четвёртый комплекс упражнений для спины.', true)
on conflict (id) do nothing;
