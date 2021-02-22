UPDATE public.accounts
SET markets = ARRAY_REMOVE(markets, ${marketId})
WHERE id = ${accountId}
