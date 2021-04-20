INSERT INTO public.players (id, name, market_id)
VALUES (${id}, ${name}, ${marketId})
ON CONFLICT (id, market_id) DO NOTHING;

UPDATE public.players
SET worlds = ARRAY_APPEND(worlds, ${worldNumber})
WHERE id = ${id} AND market_id = ${marketId};
