-- SQL CHECK treats NULL as success: require the shape explicitly as well.
alter table public.corpus_portfolios add constraint corpus_document_required_fields check (
  document ?& array['schema', 'portfolio', 'history']
  and (document->'portfolio') ? 'investments'
  and jsonb_typeof(document->'portfolio'->'investments') = 'array'
);
create function public.corpus_portfolio_revision_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.revision <> 1 then raise exception 'Initial revision must be one'; end if;
  else
    if NEW.user_id <> OLD.user_id or NEW.revision <> OLD.revision + 1 then
      raise exception 'Portfolio owner is immutable and revision must advance by one';
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;
revoke all on function public.corpus_portfolio_revision_guard() from public, anon, authenticated;
create trigger corpus_revision_guard before insert or update on public.corpus_portfolios
for each row execute function public.corpus_portfolio_revision_guard();
