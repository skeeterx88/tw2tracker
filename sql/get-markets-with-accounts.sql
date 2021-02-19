SELECT public.markets.id
FROM markets
WHERE (SELECT COUNT(*) FROM public.accounts WHERE public.markets.id = ANY(accounts.markets)) > 0;
