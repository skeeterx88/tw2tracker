UPDATE public.worlds
SET sync_enabled = ${enabled}::bool
WHERE market_id = ${marketId}
AND world_number = ${worldNumber}
