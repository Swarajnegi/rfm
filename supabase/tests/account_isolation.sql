-- Only disposable test users; every change is rolled back, including on failure.
begin;
do $$
declare
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  n integer;
  sample jsonb := '{"schema":1,"portfolio":{"investments":[]},"history":[]}';
begin
  insert into auth.users(id) values (alice), (bob);
  perform set_config('request.jwt.claim.sub', alice::text, true);
  set local role authenticated;
  select count(*) into n from public.corpus_save_portfolio(0, sample);
  if n <> 1 then raise exception 'FAIL first insert'; end if;
  select count(*) into n from public.corpus_save_portfolio(0, sample);
  if n <> 0 then raise exception 'FAIL stale insert'; end if;
  select count(*) into n from public.corpus_save_portfolio(1, sample);
  if n <> 1 then raise exception 'FAIL valid revision'; end if;
  select count(*) into n from public.corpus_save_portfolio(1, sample);
  if n <> 0 then raise exception 'FAIL stale revision'; end if;
  begin
    perform public.corpus_save_portfolio(2, '{}');
    raise exception 'FAIL invalid document accepted';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claim.sub', bob::text, true);
  select count(*) into n from public.corpus_portfolios;
  if n <> 0 then raise exception 'FAIL cross-user read'; end if;
  begin
    insert into public.corpus_portfolios(user_id, document) values (alice, sample);
    raise exception 'FAIL cross-user insert';
  exception when insufficient_privilege then null;
  end;
  update public.corpus_portfolios set document = sample, revision = revision + 1 where user_id = alice;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL cross-user update'; end if;
  reset role;
  if has_table_privilege('anon', 'public.corpus_portfolios', 'select') then
    raise exception 'FAIL anon read';
  end if;
end $$;
rollback;
select 'PASS: own writes, stale writes, invalid documents, cross-account reads/inserts/updates, anonymous access; all test data rolled back' as result;
