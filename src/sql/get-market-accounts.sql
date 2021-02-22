SELECT name, pass
FROM public.accounts
WHERE ${marketId} = ANY(markets)
