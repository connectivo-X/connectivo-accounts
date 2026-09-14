-- ============================================
-- Connectivo Accounts — database schema
-- Run this once in Supabase SQL Editor
-- ============================================

-- 1. Categories
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('income','expense')),
  group_name text default '',
  created_at timestamptz default now()
);

-- 2. Transactions
create table transactions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,
  date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_type text not null check (payment_type in ('cash','bank')),
  description text default '',
  ref text default '',
  vc_no text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- 3. User profiles (name + role, linked to Supabase auth)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text default 'Account Manager' check (role in ('Developer','Account Manager','CEO')),
  created_at timestamptz default now()
);

-- 4. Row Level Security: only logged-in office users can read/write
alter table categories enable row level security;
alter table transactions enable row level security;
alter table profiles enable row level security;

create policy "Logged-in users can read categories" on categories
  for select using (auth.role() = 'authenticated');
create policy "Logged-in users can write categories" on categories
  for all using (auth.role() = 'authenticated');

create policy "Logged-in users can read transactions" on transactions
  for select using (auth.role() = 'authenticated');
create policy "Logged-in users can write transactions" on transactions
  for all using (auth.role() = 'authenticated');

create policy "Users can read all profiles" on profiles
  for select using (auth.role() = 'authenticated');
create policy "Users can update their own profile" on profiles
  for update using (auth.uid() = id);

-- 5. Auto-create a profile row whenever a new user signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.email, 'Account Manager');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
