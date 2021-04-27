INSERT INTO public.players (id, name, market_id)
VALUES (${playerId}, ${name}, ${marketId})
ON CONFLICT (id, market_id) DO NOTHING;

UPDATE public.players
SET worlds = ARRAY_APPEND(worlds, ${worldNumber})
WHERE id = ${playerId} AND market_id = ${marketId};
