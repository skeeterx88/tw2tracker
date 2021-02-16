UPDATE public.worlds
SET sync_enabled = ${enabled}::bool
WHERE market = ${marketId}
AND num = ${worldNumber}
