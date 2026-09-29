-- One versioned document per account. CAS prevents offline devices overwriting
-- each other. The client explicitly resolves a conflict; no last-writer-wins.
create table public.corpus_portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  document jsonb not null check (
    jsonb_typeof(document) = 'object'
    and document->>'schema' = '1'
    and jsonb_typeof(document->'portfolio') = 'object'
    and jsonb_typeof(document->'history') = 'array'
    and octet_length(document::text) <= 2097152
  ),
  updated_at timestamptz not null default now()
);
alter table public.corpus_portfolios enable row level security;
revoke all on public.corpus_portfolios from anon, authenticated;
grant select, insert, update on public.corpus_portfolios to authenticated;
create policy own_read on public.corpus_portfolios for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_insert on public.corpus_portfolios for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy own_update on public.corpus_portfolios for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.corpus_save_portfolio(expected_revision bigint, new_document jsonb)
returns setof public.corpus_portfolios language plpgsql security invoker
set search_path = '' as $$
begin
  if auth.uid() is null or expected_revision is null or expected_revision < 0 then
    raise exception 'Authentication and a valid revision are required' using errcode = '22023';
  end if;
  if expected_revision = 0 then
    return query insert into public.corpus_portfolios(user_id, document)
      values (auth.uid(), new_document) on conflict (user_id) do nothing returning *;
  else
    return query update public.corpus_portfolios
      set document = new_document, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = expected_revision returning *;
  end if;
end;
$$;
revoke all on function public.corpus_save_portfolio(bigint, jsonb) from public, anon;
grant execute on function public.corpus_save_portfolio(bigint, jsonb) to authenticated;
