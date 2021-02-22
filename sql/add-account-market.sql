UPDATE public.accounts
SET markets = ARRAY_APPEND(markets, ${marketId})
WHERE id = ${accountId}
